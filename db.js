
const sqlite3 = require('better-sqlite3')

const db = sqlite3(process.env.DATABASE_PATH)

const selectUserByEmail = db.prepare('select id, email, hashedpassword from users where email=?')
const selectUserById = db.prepare('select id, email, hashedpassword from users where id=?')
const insertUser = db.prepare('insert into users (email, hashedpassword) values (@email, @hashedpassword)')
const selectPostsByUserId = db.prepare('select id, content, title from posts where userid=?')

module.exports = {
  userByEmail: email => selectUserByEmail.get(email),
  createUser: db.transaction(props => {
    const info = insertUser.run(props)
    return selectUserById.get(info.lastInsertRowid)
  }),
  postsByUserId: id => selectPostsByUserId.all(id)
}
