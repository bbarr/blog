
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
const selectSiteByHandle = db.prepare('select name, handle from site where handle=?')
const selectDefaultSiteByUserId = db.prepare(`
  select 
    s.handle 
  from 
    site s,
    user_site_role r 
  where 
    r.user_id=? and
    r.site_handle=s.handle
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

// role
const insertRole = db.prepare('insert into user_site_role (user_id, site_handle, role) values (@user_id, @site_handle, @role)')


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
    defaultByUserId: id => selectDefaultSiteByUserId.get(id),
    create: db.transaction(props => {
      insertSite.run(snakeKeys(props))
      insertRole.run(snakeKeys({ ...props, siteHandle: props.handle }))
      return selectSiteByHandle.get(props.handle)
    }),
    updateBilling(props) {
      return updateSiteBilling.run(snakeKeys(props))
    }
  },
  posts: {
    bySiteHandle: handle => selectPostsBySiteHandle.all(handle).map(camelKeys),
    byId: id => camelKeys(selectPostById.get(id)),
    contentById: id => camelKeys(selectPostContentById.get(id))
  }
}
