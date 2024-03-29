
const util = require('util')
const cp = require('child_process')
const fs = require('fs')

const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const uuid = require('uuid')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const { Liquid } = require('liquidjs')
const AWS = require('aws-sdk')
const stripe = require('stripe')(process.env.STRIPE_SECRET)
const sass = require('node-sass')

const db = require('./db')
const permissions = require('./permissions')

const jwtSignP = util.promisify(jwt.sign)
const jwtVerifyP = util.promisify(jwt.verify)
const readP = util.promisify(fs.readFile)
const server = express()
const liquid = new Liquid({
  globals: {
    isProduction: process.env.NODE_ENV === 'production'
  }
});

AWS.config.update({ 
  endpoint: process.env.SPACES_ENDPOINT,
  region: process.env.SPACES_REGION, 
  accessKeyId: process.env.SPACES_ACCESS_KEY, 
  secretAccessKey: process.env.SPACES_ACCESS_SECRET,
  signatureVersion: 'v4'
})

const s3 = new AWS.S3()

liquid.registerFilter('escapeMarkdown', str => {
  return str.replace(/`/g, '\\`')
})

	/*
server.use((req, res, next) => {
	if (req.hostname === process.env.HOSTNAME)
		return next()
	console.log('THIS SHOULD NEVER HAPPEN', req.hostname, req.path, process.env.HOSTNAME)
	req.url = `/${req.hostname}${req.path}`
	next()
})
*/

server.engine('liquid', liquid.express())
//server.use(express.static(`${process.env.SITES_DIR}`))
server.use(express.static(`${__dirname}/assets`))
server.use(cookieParser(process.env.COOKIE_SECRET))
server.set('view engine', 'liquid');

server.use(bodyParser.json({
  verify: (req, res, buf) => {
    req.rawBody = buf
  }
}))

const respond = (res, status, body) => {
  const payload = status > 199 && status < 400 ? { data: body, error: null } : { data: null, error: body }
  res.status(status).send(payload)
}

const safeRoute = fn => {
  return (req, res) => {
    try {
      fn(req, res)
    } catch(e) {
      res.status(400).send(e.message)
    }
  }
}

const safe = (fn, ...args) => {
  try {
    return [ fn(...args), null ]
  } catch(e) {
    return [ null, e ]
  }
}

const safeP = p => p.then(
  d => [ d, null ],
  e => [ null, e ]
)


server.use(async (req, res, next) => {
  try {

    const jwt = req.signedCookies.auth
    const { userId, siteId, permissions, billingCustomerId, billingPeriodEnd } = await jwtVerifyP(jwt, process.env.JWT_SECRET)
    console.log('auth!', userId, siteId, permissions, billingPeriodEnd, billingCustomerId)
    res.locals.userId = userId
    res.locals.siteId = siteId
    res.locals.permissions = permissions
    res.locals.billingPeriodEnd = billingPeriodEnd

    // handle those waiting for Stripe callback
    const billingPending = req.cookies.billingPending
    if (billingPending) {
      const site = db.sites.byId(siteId)
      console.log('there is billing pending', 'site', site.billingPeriodEnd, 'cookie', billingPeriodEnd)
      if (site.billingPeriodEnd !== billingPeriodEnd) {
        res.clearCookie('billingPending')
        res.locals.billingPeriodEnd = site.billingPeriodEnd
        console.log('writing new auth cookie', { 
          userId, 
          siteId, 
          permissions, 
          billingCustomerId: site.billingCustomerId, 
          billingPeriodEnd: site.billingPeriodEnd
        })
        res.cookie('auth', await jwtSignP({ 
          userId, 
          siteId, 
          permissions, 
          billingCustomerId: site.billingCustomerId, 
          billingPeriodEnd: site.billingPeriodEnd
        }, process.env.JWT_SECRET), { httpOnly: true, signed: true })
      }
    }
  } catch(e) {}
  next()
})

server.use(async (req, res, next) => {
  if (res.locals.billingPeriodEnd && res.locals.billingPeriodEnd < unixTimestamp()) {
    res.clearCookie('auth')
    return res.redirect('/account-expired')
  }
  next()
})

function requireUser(req, res, next) {
  if (!res.locals.userId)
    return res.redirect('/login')
  if (res.locals.userId && !res.locals.siteId)
    return res.redirect('/signup')
  next()
}

server.get('/', (req, res) => {
  res.render('index.liquid')
})

server.get('/account-expired', (req, res) => {
  res.send(`
    Account Expired - Please <a href="mailto:contact@prosaic.blog">contact us</a> to reinstate.
  `)
})

server.get('/dashboard', requireUser, (req, res) => {

  const posts = db.posts.bySiteId(res.locals.siteId)
  const site = db.sites.byId(res.locals.siteId)

  res.render('dashboard.liquid', {
    cannotPublish: trialAndPublished(res),
    posts,
    site,
    env: process.env
  })
})

server.get('/settings/:type', requireUser, (req, res) => {

  const user = db.users.byId(res.locals.userId)
  const posts = db.posts.bySiteId(res.locals.siteId)
  const site = db.sites.byId(res.locals.siteId)
  const themes = [ 
    { 
      id: 'base', 
      label: 'Base',
      settings: [
        {
          type: 'color', 
          label: 'Link color',
          id: 'link-color',
          value: ''
        }
      ]
    }, 
    { 
      id: 'paper', 
      label: 'Paper',
      settings: [
        {
          type: 'multi', 
          label: 'Mode',
          id: 'mode',
          options: [
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' }
          ]
        },
        {
          type: 'color', 
          label: 'Link color (in dark mode)',
          id: 'link-color-dark',
          value: ''
        },
        {
          type: 'color', 
          label: 'Link color (in light mode)',
          id: 'link-color-light',
          value: ''
        },
        {
          type: 'boolean', 
          label: 'Show user dark-mode toggle?',
          id: 'mode-toggle',
          options: [
            { label: 'Light', value: 'light' },
            { label: 'Dark', value: 'dark' }
          ]
        }
      ]
    } 
  ]

  res.render(`settings-${req.params.type}.liquid`, {
    user,
    posts,
    site,
    themes
  })
})

server.get('/admin/settings', requireUser, (req, res) => {
  res.render('settings.liquid', { sites: [] })
})

server.get('/login', (req, res) => {
  res.render('login.liquid')
})

server.get('/signup', (req, res) => {
  console.log('signup is user', !!res.locals.userId)
  res.render('signup.liquid')
})

server.get('/editor/new', (req, res) => {
  const site = db.sites.byId(res.locals.siteId)
  res.render('editor.liquid', {
    cannotPublish: trialAndPublished(res),
    post: { id: 'new', title: '', tags: '', content: '', featuredImage: '' },
    site,
    env: process.env
  })
})

server.get('/editor/:id', (req, res) => {
  const post = db.posts.byId(req.params.id)
  const site = db.sites.byId(res.locals.siteId)
  const publishedId = trialAndPublished(res)
  console.log(publishedId, req.params.id)
  res.render('editor.liquid', {
    cannotPublish: publishedId && publishedId != req.params.id,
    post,
    site,
    env: process.env
  })
})

server.put('/api/settings', (req, res) => {

  const [ userUpdates, userUpdatesE ] = safe(db.users.update, {
    id: res.locals.userId,
    name: req.body.name,
    email: req.body.email,
    avatar: req.body.avatar
  })

  if (userUpdatesE)
    return respond(res, 400, userUpdatesE.message)

  const [ siteUpdates, siteUpdatesE ] = safe(db.sites.update, {
    id: res.locals.siteId,
    name: req.body.title,
    description: req.body.description,
    favicon: req.body.favicon,
    timezone: req.body.timezone,
    customDomain: req.body.customDomain
  })

  if (siteUpdatesE)
    return respond(res, 400, siteUpdatesE.message)

  respond(res, 200)
})

server.put('/api/theme-settings', (req, res) => {

  const [ siteUpdates, siteUpdatesE ] = safe(db.sites.updateThemeSettings, {
    id: res.locals.siteId,
    themeSettings: JSON.stringify(req.body.themeSettings)
  })

  if (siteUpdatesE) 
    return respond(res, 400, siteUpdatesE.message)

  respond(res, 200)
})

server.put('/api/theme', (req, res) => {

  const [ siteUpdates, siteUpdatesE ] = safe(db.sites.updateTheme, {
    id: res.locals.siteId,
    themeId: req.body.themeId
  })

  if (siteUpdatesE) 
    return respond(res, 400, siteUpdatesE.message)

  respond(res, 200)
})

server.get('/api/posts/:id', (req, res) => {
  respond(res, 200, db.posts.byId(req.params.id))
})

server.get('/api/posts/:id/content', (req, res) => {
  respond(res, 200, db.posts.contentById(req.params.id).content)
})

server.delete('/api/posts/:id', async (req, res) => {
  db.posts.delete({ id: req.params.id, userId: res.locals.userId })
  db.deploys.push({ siteId: res.locals.siteId })
  respond(res, 200)
})

server.post('/api/posts/:id/unpublish', async (req, res) => {

  const post = db.posts.byId(req.params.id)

  if (post && post.siteId === res.locals.siteId) {
    db.posts.markAsUnpublished(post)
    db.deploys.push({ siteId: res.locals.siteId })
  }
  respond(res, 200)
})

server.get('/api/validate-handle/:handle', (req, res) => {
  respond(res, db.sites.validateHandle(req.params.handle) ? 200 : 400)
})

server.get('/api/validate-domain', (req, res) => {
  respond(res, db.sites.validateDomain(req.query.domain) ? 200 : 400)
})

function trialAndPublished(res) {
  console.log('trialandpublished', res.locals.billingPeriodEnd)
  if (res.locals.billingPeriodEnd) 
    return false
  const post = db.posts.hasPublishedPosts(res.locals.userId)
  console.log('trialandpublished 2', post)
  return post && post.id
}

server.post('/api/posts/:id/publish', async (req, res) => {

  const publishedId = trialAndPublished(res)

  if (publishedId && req.params.id != publishedId) {
    console.log('Tried to deploy (publish) but not a paying user and already published something.', res.locals)
    return respond(res, 401)
  }

  const post = db.posts.byId(req.params.id)

  if (post && post.siteId === res.locals.siteId) {
    db.posts.markAsPublished(post)
    db.deploys.push({ siteId: res.locals.siteId })
  }

  respond(res, 200)
})

server.post('/api/posts', async (req, res) => {

  if (!res.locals.userId)
    return respond(res, 400)

  const [ saved, savedE ] = safe(db.posts.create, { 
    siteId: res.locals.siteId,
    userId: res.locals.userId,
    title: req.body.title,
    tags: req.body.tags,
    featuredImage: req.body.featuredImage,
    content: req.body.content,
  })

  if (savedE)
    return respond(res, 400, savedE.message)

  respond(res, 201, { id: saved.lastInsertRowid })
})

server.put('/api/posts/:id',  (req, res) => {

  if (!res.locals.userId)
    return respond(res, 400)

  const [ saved, savedE ] = safe(db.posts.update, { 
    userId: res.locals.userId,
    id: req.params.id,
    title: req.body.title,
    tags: req.body.tags,
    featuredImage: req.body.featuredImage,
    content: req.body.content
  })

  if (savedE)
    return respond(res, 400, savedE.message)

  respond(res, 200)
})

server.delete('/api/posts/:id', (req, res) => {

})

server.post('/api/posts/:id', (req, res) => {

})

server.post('/api/login', async (req, res) => {

  const { email, password } = req.body

  const user = db.users.byEmail(email)
  const { id, hashed_password: hashedPassword } = user || {}
  if (!id) return respond(res, 400) 

  if (await bcrypt.compare(password, hashedPassword)) {
    const { siteId, permissions, billingPeriodEnd, billingCustomerId } = db.sites.defaultByUserId(id)
	  console.log(siteId, permissions, billingPeriodEnd, billingCustomerId)
    if (!siteId) {
      res.cookie('auth', await jwtSignP({ userId: id }, process.env.JWT_SECRET), { httpOnly: true, signed: true })
    } else {
      res.cookie('auth', await jwtSignP({ userId: id, siteId, permissions, billingCustomerId, billingPeriodEnd }, process.env.JWT_SECRET), { httpOnly: true, signed: true })
    }
    return respond(res, 200)
  }

  return respond(res, 400)
})

server.post('/api/create-user', async (req, res) => {

  const { name, email, password } = req.body

  const hashedPassword = await bcrypt.hash(password, 10 /* salt rounds */)

  const [ user, userE ] = safe(db.users.create, { 
    name,
    email, 
    hashedPassword,
  })

  if (userE)
    return respond(res, 400, userE.message)

  res.cookie('auth', await jwtSignP({ userId: user.id }, process.env.JWT_SECRET), { httpOnly: true, signed: true })

  respond(res, 201, user)
})

function unixTimestamp(d=new Date) {
  return d.getTime() / 1000
}

server.post('/api/create-site', async (req, res) => {
  if (!res.locals.userId)
    return respond(res, 400)

  const { name, handle, stripeToken } = req.body

  const [ site, siteE ] = safe(db.sites.create, { 
    billingCustomerId: '',
    billingSubscriptionId: '',
    themeId: 'paper',
    billingPeriodEnd: '', 
    permissions: permissions.forOwner(),
    name,
    handle,
    userId: res.locals.userId
  })

  if (siteE) 
    return respond(res, 400, siteE.message)

  res.cookie('auth', await jwtSignP({ userId: res.locals.userId, siteId: site.id, billingCustomerId: '', billingPeriodEnd: '', permissions: permissions.forOwner() }, process.env.JWT_SECRET), { httpOnly: true, signed: true })

  respond(res, 200)
})

server.get('/api/create-billing-session', async (req, res) => {
  const site = db.sites.byId(res.locals.siteId)
	const sessionData = {
		payment_method_types: ['card'],
		line_items: [{
			price: process.env.STRIPE_PRICE_ID,
			quantity: 1,
		}],
		client_reference_id: site.id,
		customer_email: db.users.byId(res.locals.userId).email,
		mode: 'subscription',
		success_url: `${process.env.DOMAIN}/dashboard#billing-success`,
		cancel_url: `${process.env.DOMAIN}/dashboard#billing-error`
	}
	if (process.env.NODE_ENV === 'production' && ['brendan','blog','nick','john','allison'].includes(site.handle))
    sessionData.subscription_data = { coupon: '3x5LLtG3' }
  const session = await stripe.checkout.sessions.create(sessionData);
  res.cookie('billingPending', true)
  respond(res, 200, session)
})

server.get('/api/create-update-billing-session', async (req, res) => {
  const site = db.sites.byId(res.locals.siteId)
  console.log('site', site)
  var session = await stripe.billingPortal.sessions.create({
    customer: site.billingCustomerId,
    return_url: `${process.env.DOMAIN}/settings`,
  })
  res.cookie('billingPending', true)
  respond(res, 200, session.url)
})

server.get('/api/presigned-upload-url', async (req, res) => {
  const uploadId = `${res.locals.siteId}/${uuid.v4()}.jpg`
  const uploadUrl = await s3.getSignedUrlPromise('putObject', { Bucket: process.env.SPACES_UPLOADS_BUCKET, Key: uploadId, ContentType: 'image/jpeg' })
  const staticUrl = `https://${process.env.SPACES_UPLOADS_BUCKET}.${process.env.SPACES_ENDPOINT.replace(process.env.SPACES_REGION, `${process.env.SPACES_REGION}.cdn`)}/${uploadId}`
  respond(res, 200, [ uploadUrl, staticUrl ])
})

function addMonths(date, months) {
    var d = date.getDate();
    date.setMonth(date.getMonth() + +months);
    if (date.getDate() != d) {
      date.setDate(0);
    }
    return date;
}

server.post('/stripe-subscription', async (req, res) => {
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(req.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.log('Webhook failed: ', err.message)
    respond(res, 400)
  }

  let site;

  switch (event.type) {
    case 'invoice.paid':
      const invoice = event.data.object
      console.log('invoice', invoice)
      site = db.sites.byBillingCustomerId(invoice.customer)
      if (site) {
        db.sites.updateBilling({
          id: site.id,
          billingCustomerId: invoice.customer,
          billingPeriodEnd: invoice.lines.data[0].period.end
        })
      } else {
        db.pendingInvoices.add({
          billingCustomerId: invoice.customer,
          billingPeriodEnd: invoice.lines.data[0].period.end
        })
      }
      break;
    case 'checkout.session.completed':
      const session = event.data.object
      console.log('session', session)
      site = db.sites.byId(session.client_reference_id)
      const pending = db.pendingInvoices.get(session.customer)
      const billingPeriodEnd = pending ? pending.billingPeriodEnd : site.billingPeriodEnd
		  console.log('new billing period end!', billingPeriodEnd)
      db.sites.updateBilling({
        id: site.id,
        billingCustomerId: session.customer,
        billingPeriodEnd: billingPeriodEnd
      })
      break
    case 'customer.subscription.updated':
      console.log('subscription changed... we dont care about this yet, wait for invoice.paid or not')
      
      break
    default:
      return respond(res, 400)
  }

  respond(res, 200)
})

server.get('/allow-domain', async (req, res) => {
  const { domain } = req.query
  const error = domain === process.env.HOSTNAME ? 
		false : 
		(domain.indexOf(process.env.HOSTNAME) > -1 ? db.sites.validateHandle(domain.split('.')[0]) : db.sites.validateDomain(domain))
  console.log('allow domain?', domain, !error, domain.indexOf(process.env.HOSTNAME))
  respond(res, !error ? 200 : 400)
})


module.exports = server
