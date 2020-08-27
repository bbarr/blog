
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
const selectUserByEmail = db.prepare('select id, email, hashed_password from user where email=?')
const selectUserById = db.prepare('select id, email from user where id=?')
const insertUser = db.prepare('insert into user (name, email, hashed_password) values (@name, @email, @hashed_password)')

// site
const selectSiteByHandle = db.prepare('select name, handle, theme_id from site where handle=?')
const selectDefaultSiteByUserId = db.prepare(`
  select 
    s.handle 
  from 
    site s,
    user_site_permission p 
  where 
    p.user_id=? and
    p.site_handle=s.handle
  limit 1;
  `)
const insertSite = db.prepare(`
  insert into site
    (name, handle, billing_subscription_id, billing_is_active) 
  values 
    (@name, @handle, @billing_subscription_id, @billing_is_active)
`)
const updateSiteBilling = db.prepare(`
  update site 
     set 
         billing_subscription_id=@billing_subscription_id, 
         billing_is_active=@billing_is_active 
   where handle=@handle
`)

// post
const selectPostsBySiteHandle = db.prepare('select id, content, title, created_at, updated_at, published_at from post where site_handle=?')
const selectPostContentById = db.prepare('select content from post where id=?')
const selectPostById = db.prepare('select * from post where id=?')
const updatePost = db.prepare('update post set title=@title, content=@content where id=@id and user_id=@user_id')
const insertPost = db.prepare('insert into post (title, content, user_id, site_handle) values (@title, @content, @user_id, @site_handle)')

// permissions
const insertPermissions = db.prepare('insert into user_site_permission (user_id, site_handle, list) values (@user_id, @site_handle, @list)')

// deploys
const insertDeploy = db.prepare('insert into deploy (post_id) values (?)')

module.exports = {
  users: {
    byEmail(email) {
      return selectUserByEmail.get(email)
    },
    create: db.transaction(props => {
      const info = insertUser.run(snakeKeys(props))
      return selectUserById.get(info.lastInsertRowid)
    })
  },
  sites: {
    defaultByUserId: id => camelKeys(selectDefaultSiteByUserId.get(id)),
    byHandle: handle => camelKeys(selectSiteByHandle.get(handle)),
    create: db.transaction(props => {
      insertSite.run(snakeKeys(props))
      insertPermissions.run(snakeKeys({ userId: props.userId, siteHandle: props.handle, list: props.permissions }))
      return selectSiteByHandle.get(props.handle)
    }),
    updateBilling(props) {
      return updateSiteBilling.run(snakeKeys(props))
    }
  },
  posts: {
    bySiteHandle: handle => selectPostsBySiteHandle.all(handle).map(camelKeys),
    byId: id => camelKeys(selectPostById.get(id)),
    contentById: id => camelKeys(selectPostContentById.get(id)),
    update: props => updatePost.run(snakeKeys(props)),
    create: props => insertPost.run(snakeKeys(props))
  },
  deploys: {
    create: postId => insertDeploy(postId)
  }
}
