
const sqlite3 = require('better-sqlite3')

const db = sqlite3(process.env.DATABASE_PATH)

function camelToSnake(key) {
  return key.replace(/([A-Z])/g, '_$1').toLowerCase();
}

function snakeToCamel(key) {
  return key.replace(/(_\w)/g, match => match.substr(1).toUpperCase())
}

function transformKeys(transformer, input) {
  const output = {}
  for (const key of Object.keys(input)) {
    output[transformer(key)] = input[key];
  }
  return output
}

const snakeKeys = transformKeys.bind(null, camelToSnake)
const camelKeys = transformKeys.bind(null, snakeToCamel)

// user
const selectUserByEmail = db.prepare('select id, avatar, name, email, hashed_password from user where email=?')
const selectUserBySiteId = db.prepare('select u.id, u.avatar, u.name, u.email from user u, user_site_permission usp where usp.site_id = ? and usp.user_id = u.id')
const selectUserById = db.prepare('select id, avatar, name, email from user where id=?')
const insertUser = db.prepare('insert into user (name, email, hashed_password) values (@name, @email, @hashed_password)')
const updateUser = db.prepare('update user set name=@name, email=@email, avatar=@avatar where id=@id')

// site
const selectSiteById = db.prepare('select id, name, handle, custom_domain, billing_customer_id, billing_period_end, theme_id, theme_settings, description, timezone, favicon from site where id=?')
const selectSiteByBillingCustomerId = db.prepare('select id, billing_customer_id, billing_period_end from site where billing_customer_id=?')
const selectDefaultSiteByUserId = db.prepare(`
  select 
    s.id as site_id,
    p.list as permissions,
    s.billing_period_end
  from 
    site s,
    user_site_permission p 
  where 
    p.user_id=? and
    p.site_id=s.id
  limit 1;
  `)
const insertSite = db.prepare(`
  insert into site
    (name, handle, billing_customer_id, billing_period_end) 
  values 
    (@name, @handle, @billing_customer_id, @billing_period_end)
`)
const updateSiteBilling = db.prepare(`
  update site 
     set 
         billing_customer_id=@billing_customer_id,
         billing_period_end=@billing_period_end 
   where id=@id
`)
const updateSite = db.prepare('update site set name=@name, description=@description, favicon=@favicon, timezone=@timezone, custom_domain=@custom_domain where id=@id')
const updateSiteTheme = db.prepare('update site set theme_id=@theme_id, theme_settings=@theme_settings where id=@id')
const validateHandle = db.prepare('select 1 from site where handle=?')
const validateDomain = db.prepare('select 1 from site where custom_domain=?')

// post
const selectPostsBySiteId = db.prepare('select id, content, title, tags, published_title, created_at, updated_at, published_at, latest_published_at from post where site_id=?')
const selectPostContentById = db.prepare('select content from post where id=?')
const selectPostById = db.prepare('select * from post where id=?')
const selectPostByIdLite = db.prepare('select title, tags, published_title, published_at, latest_published_at from post where id=?')
const selectPostPage = db.prepare(`
  select p.title, tags, p.published_title, p.published_at, p.content, u.avatar as user_avatar, u.name as user_name
    from post p, user u
   where 
         p.site_id=@site_id 
     and p.user_id=u.id
     and published_at is not null
     and p.id not in (
         select p.id 
           from post p, user u
          where 
                p.site_id=@site_id
            and p.user_id=u.id
            and published_at is not null
       order by p.id asc 
          limit @offset
     )
order by p.id asc 
   limit @limit
`)
const updatePost = db.prepare('update post set updated_at=current_timestamp, tags=@tags, title=@title, content=@content where id=@id and user_id=@user_id')
const updatePostPublishedTitle = db.prepare('update post set published_title=@title where id=@id')
const updatePostToPublished = db.prepare('update post set published_at=current_timestamp, latest_published_at=current_timestamp where id=?')
const updatePostToPublishedAgain = db.prepare('update post set latest_published_at=current_timestamp where id=?')
const updatePostToUnpublished = db.prepare('update post set published_at=null, latest_published_at=null where id=?')
const insertPost = db.prepare('insert into post (title, tags, content, user_id, site_id) values (@title, @tags, @content, @user_id, @site_id)')
const deletePostById = db.prepare('delete from post where id=@id and user_id=@user_id')

// permissions
const insertPermissions = db.prepare('insert into user_site_permission (user_id, site_id, list) values (@user_id, @site_id, @list)')

// deploys
const insertDeploy = db.prepare('insert into deploy (site_id) values (@site_id)')
const selectNextDeploy = db.prepare('select id, site_id from deploy limit 1')
const deleteDeploy = db.prepare('delete from deploy where id=?')

const insertPendingInvoice = db.prepare('insert into pending_invoice (billing_customer_id, billing_period_end) values (@billing_customer_id, @billing_period_end)')
const selectPendingInvoiceByBillingCustomerId = db.prepare('select * from pending_invoice where billing_customer_id=?')
const deletePendingInvoice = db.prepare('delete from pending_invoice where billing_customer_id=?')

module.exports = {
  users: {
    byEmail(email) {
      return selectUserByEmail.get(email)
    },
    create: db.transaction(props => {
      const info = insertUser.run(snakeKeys(props))
      return selectUserById.get(info.lastInsertRowid)
    }),
    byId(id) {
      return selectUserById.get(id)
    },
    update: props => updateUser.run(snakeKeys(props))
  },
  sites: {
    defaultByUserId: id => camelKeys(selectDefaultSiteByUserId.get(id)),
    byId: id => camelKeys(selectSiteById.get(id)),
    byBillingCustomerId(id) {
      const site = selectSiteByBillingCustomerId.get(id)
      return site && camelKeys(site)
    },
    create: db.transaction(props => {
      const info = insertSite.run(snakeKeys(props))
      insertPermissions.run(snakeKeys({ userId: props.userId, siteId: info.lastInsertRowid, list: props.permissions }))
      return selectSiteById.get(info.lastInsertRowid)
    }),
    updateBilling(props) {
      return updateSiteBilling.run(snakeKeys(props))
    },
    update: db.transaction(props => {
      updateSite.run(snakeKeys(props))
      return insertDeploy.run(snakeKeys({ siteId: props.id }))
    }),
    updateTheme: db.transaction(props => {
      updateSiteTheme.run(snakeKeys(props))
      return insertDeploy.run(snakeKeys({ siteId: props.id }))
    }),
    validateHandle(handle) {
      const existing = validateHandle.get(handle)
      console.log('existing handle', existing, handle)
      return !existing
    },
    validateDomain(domain) {
      const existing = validateDomain.get(domain)
      console.log('existing domain', existing, domain)
      return !existing
    }
  },
  posts: {
    bySiteId: siteId => selectPostsBySiteId.all(siteId).map(camelKeys),
    byId: id => camelKeys(selectPostById.get(id)),
    byIdLite: id => camelKeys(selectPostByIdLite.get(id)),
    getPage: props => {

      // add one
      props.limit++

      let page = selectPostPage.all(snakeKeys(props)).map(camelKeys)

      // remove one
      props.limit--

      const extra = !!page[props.limit]
      return [ page.slice(0, props.limit), extra ]
    },
    contentById: id => camelKeys(selectPostContentById.get(id)),
    update: props => {
      const safeTags = props.tags.replace(/ /g, '')
      props.tags = safeTags
      return updatePost.run(snakeKeys(props))
    },
    create: props => insertPost.run(snakeKeys(props)),
    delete: props => deletePostById.run(snakeKeys(props)),
    markAsPublished: db.transaction(post => {
      if (!post.publishedTitle)
        updatePostPublishedTitle.run({ id: post.id, title: post.title })
      return post.publishedAt ? 
        updatePostToPublishedAgain.run(post.id) : 
        updatePostToPublished.run(post.id)
    }),
    markAsUnpublished: post => updatePostToUnpublished.run(post.id)
  },
  deploys: {
    push: (props) => insertDeploy.run(snakeKeys(props)),
    pull: db.transaction(() => {
      const rawDeploy = selectNextDeploy.get()
      if (rawDeploy) {
        const deploy = camelKeys(rawDeploy)
        if (deploy) deleteDeploy.run(deploy.id)
        const site = selectSiteById.get(deploy.siteId)
        site && (site.theme_settings = JSON.parse(site.theme_settings))
        console.log(site.theme_settings)
        const post = selectPostById.get(deploy.postId)
        const user = selectUserBySiteId.get(deploy.siteId)
        return [
          deploy,
          site ? camelKeys(site) : site,
          post ? camelKeys(post) : post,
          user ? camelKeys(user) : user
        ]
      }
      return []
    })
  },
  pendingInvoices: {
    add: props => insertPendingInvoice.run(snakeKeys(props)),
    get: db.transaction(id => {
      const pi = selectPendingInvoiceByBillingCustomerId.get(id)
      if (pi) {
        deletePendingInvoice.run(pi.billing_customer_id)
        return camelKeys(pi)
      }
      return null
    })
  }
}
