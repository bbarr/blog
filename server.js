
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

const db = require('./db')
const permissions = require('./permissions')

const jwtSignP = util.promisify(jwt.sign)
const jwtVerifyP = util.promisify(jwt.verify)
const server = express()
const liquid = new Liquid();

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

server.engine('liquid', liquid.express())
server.use(express.static(`${__dirname}/assets`))
server.use(bodyParser.json())
server.use(cookieParser(process.env.COOKIE_SECRET))
server.set('view engine', 'liquid');

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
    const { userId, siteHandle, sitePermissions } = await jwtVerifyP(jwt, process.env.JWT_SECRET)
    console.log('auth!', userId, siteHandle, sitePermissions)
    res.locals.userId = userId
    res.locals.siteHandle = siteHandle
    res.locals.roles = roles
  } catch(e) {}
  next()
})

function requireUser(req, res, next) {
  if (!res.locals.userId)
    return res.redirect('/login')
  if (res.locals.userId && !res.locals.siteHandle)
    return res.redirect('/signup')
  next()
}

server.get('/', (req, res) => {
  res.render('index.liquid')
})

server.get('/dashboard', requireUser, (req, res) => {

  const posts = db.posts.bySiteHandle(res.locals.siteHandle)
  const site = db.sites.byHandle(res.locals.siteHandle)

  console.log(site)
  res.render('dashboard.liquid', {
    posts,
    site
  })
})

server.get('/settings', requireUser, (req, res) => {

  const user = db.users.byId(res.locals.userId)
  const posts = db.posts.bySiteHandle(res.locals.siteHandle)
  const site = db.sites.byHandle(res.locals.siteHandle)

  res.render('settings.liquid', {
    user,
    posts,
    site
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
  res.render('signup.liquid', {
    isUser: !!res.locals.userId
  })
})

server.get('/editor/new', (req, res) => {
  const site = db.sites.byHandle(res.locals.siteHandle)
  res.render('editor.liquid', {
    post: { id: 'new', title: '', content: '' },
    site
  })
})

server.get('/editor/:id', (req, res) => {
  const post = db.posts.byId(req.params.id)
  const site = db.sites.byHandle(res.locals.siteHandle)
  res.render('editor.liquid', {
    post,
    site
  })
})

server.get('/api/posts/:id/content', (req, res) => {
  respond(res, 200, db.posts.contentById(req.params.id).content)
})

server.post('/api/posts/:id/publish', async (req, res) => {

  const [ site, siteE ] = safe(db.sites.byHandle, res.locals.siteHandle)
  if (siteE)
    return respond(res, 404, postE.message)

  console.log('publishing site', site, req.params.id)

  const [ deployed, deployedE ] = safe(db.deploys.push, {
    postId: parseInt(req.params.id, 10),
    siteHandle: res.locals.siteHandle,
    themeId: site.themeId
  }) 

  console.log(deployed, deployedE)

  if (deployedE)
    return respond(res, 400, deployedE.message)

  respond(res, 200)
})

server.post('/api/posts', (req, res) => {
  
  if (!res.locals.userId)
    return respond(res, 400)

  const [ saved, savedE ] = safe(db.posts.create, { 
    siteHandle: res.locals.siteHandle,
    userId: res.locals.userId,
    title: req.body.title,
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

  const { id, hashed_password: hashedPassword } = db.users.byEmail(email)
  if (!id) return res.sendStatus(404) 

  console.log(password, hashedPassword)
  if (await bcrypt.compare(password, hashedPassword)) {
    const { handle } = db.sites.defaultByUserId(id)
    if (!handle) {
      res.cookie('auth', await jwtSignP({ userId: id }, process.env.JWT_SECRET), { httpOnly: true, signed: true })
    } else {
      res.cookie('auth', await jwtSignP({ userId: id, siteHandle: handle, sitePermissions: '' }, process.env.JWT_SECRET), { httpOnly: true, signed: true })
    }
    return respond(res, 200)
  }

  return respond(res, 404)
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

server.post('/api/create-site', async (req, res) => {
  if (!res.locals.userId)
    return respond(res, 400)

  const { name, handle, stripeToken } = req.body

  const [ site, siteE ] = safe(db.sites.create, { 
    billingSubscriptionId: '',
    billingIsActive: 1,
    permissions: permissions.forOwner(),
    name,
    handle,
    userId: res.locals.userId
  })

  if (siteE) 
    return respond(res, 400, siteE.message)

  /*
  const [ stripeCustomer, stripeCustomerE ] = await safeP(
    stripe.customers.create({
      name,
      email,
      source: stripeToken
    })
  )
  if (stripeCustomerE)
    console.log('error making stripe customer!', stripeCustomerE.message)

  const [ stripeSubscription, stripeSubscriptionE ] = await safeP(
    tripe.subscriptions.create({
      customer: customer.id,
      items: [ { price: process.env.STRIPE_BASIC_PLAN_PRICE_ID } ]
    })
  )
  if (stripeSubscriptionE)
    console.log('error making stripe subscription!', stripeSubscriptionE.message)

  const [ updatedSite, updatedSiteE ] = safe(db.updateSite, {
    handle: site.id,
    billingSubscriptionId: stripeSubscription.id,
    billingIsActive: stripeSubscription.status === 'active'
  })
  */

  res.cookie('auth', await jwtSignP({ userId: res.locals.userId, siteHandle: site.handle, sitePermissions: permissions.forOwner() }, process.env.JWT_SECRET), { httpOnly: true, signed: true })

  respond(res, 201, site)
})

server.get('/api/presigned-upload-url', async (req, res) => {
  const uploadId = `${res.locals.siteHandle}/${uuid.v4()}.jpg`
  const uploadUrl = await s3.getSignedUrlPromise('putObject', { Bucket: process.env.SPACES_UPLOADS_BUCKET, Key: uploadId, ContentType: 'image/jpeg' })
  const staticUrl = `https://${process.env.SPACES_UPLOADS_BUCKET}.${process.env.SPACES_ENDPOINT.replace(process.env.SPACES_REGION, `${process.env.SPACES_REGION}.cdn`)}/${uploadId}`
  respond(res, 200, [ uploadUrl, staticUrl ])
})

module.exports = server
