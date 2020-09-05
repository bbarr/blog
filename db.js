
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
const selectUserById = db.prepare('select id, avatar, name, email from user where id=?')
const insertUser = db.prepare('insert into user (name, email, hashed_password) values (@name, @email, @hashed_password)')
const updateUser = db.prepare('update user set name=@name, email=@email, avatar=@avatar where id=@id')

// site
const selectSiteById = db.prepare('select id, name, handle, billing_customer_id, billing_period_end, theme_id, description, timezone, favicon from site where id=?')
const selectSiteByBillingCustomerId = db.prepare('select id, billing_customer_id, billing_period_end from site where billing_customer_id=?')
const selectDefaultSiteByUserId = db.prepare(`
  select 
    s.id 
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
const updateSite = db.prepare('update site set name=@name, description=@description, favicon=@favicon, timezone=@timezone where id=@id')
const validateHandle = db.prepare('select 1 from site where handle=?')

// post
const selectPostsBySiteId = db.prepare('select id, content, title, created_at, updated_at, published_at, latest_published_at from post where site_id=?')
const selectPostContentById = db.prepare('select content from post where id=?')
const selectPostById = db.prepare('select * from post where id=?')
const selectPostByIdLite = db.prepare('select title, published_at, latest_published_at from post where id=?')
const updatePost = db.prepare('update post set updated_at=current_timestamp, title=@title, content=@content where id=@id and user_id=@user_id')
const updatePostToPublished = db.prepare('update post set published_at=current_timestamp, latest_published_at=current_timestamp where id=?')
const updatePostToPublishedAgain = db.prepare('update post set latest_published_at=current_timestamp where id=?')
const updatePostToUnpublished = db.prepare('update post set published_at=null, latest_published_at=null where id=?')
const insertPost = db.prepare('insert into post (title, content, user_id, site_id) values (@title, @content, @user_id, @site_id)')
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
      insertPermissions.run(snakeKeys({ userId: props.userId, siteId: props.siteId, list: props.permissions }))
      return selectSiteById.get(info.lastInsertRowid)
    }),
    updateBilling(props) {
      return updateSiteBilling.run(snakeKeys(props))
    },
    update: props => {
      return updateSite.run(snakeKeys(props))
    },
    validateHandle(handle) {
      const existing = validateHandle.get(handle)
      console.log('existing handle', existing, handle)
      return !existing
    }
  },
  posts: {
    bySiteId: siteId => selectPostsBySiteId.all(siteId).map(camelKeys),
    byId: id => camelKeys(selectPostById.get(id)),
    byIdLite: id => camelKeys(selectPostByIdLite.get(id)),
    contentById: id => camelKeys(selectPostContentById.get(id)),
    update: props => updatePost.run(snakeKeys(props)),
    create: props => insertPost.run(snakeKeys(props)),
    delete: props => deletePostById.run(snakeKeys(props)),
    markAsPublished: post => post.publishedAt ? updatePostToPublishedAgain.run(post.id) : updatePostToPublished.run(post.id),
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
        const post = selectPostById.get(deploy.postId)
        return [
          deploy,
          site,
          post
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
