
const util = require('util')

const express = require('express')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const uuid = require('uuid')
const jwt = require('jsonwebtoken')
const bcrypt = require('bcrypt')
const { Liquid } = require('liquidjs')

const db = require('./db')

const jwtSignP = util.promisify(jwt.sign)
const jwtVerifyP = util.promisify(jwt.verify)
const server = express()
const liquid = new Liquid();

server.engine('liquid', liquid.express())
server.use(bodyParser.json())
server.use(cookieParser(process.env.COOKIE_SECRET))
server.set('view engine', 'liquid');

async function requireAuth(req, res, next) {

  const jwt = req.signedCookies.auth
  console.log(req.signedCookies)

  try {
    const { id } = await jwtVerifyP(jwt, process.env.JWT_SECRET)
    res.locals.userId = id
    next()
  } catch(e) {
    return res.redirect('/')
  }
}

server.get('/', (req, res) => {
  res.render('index.liquid')
})

server.get('/dashboard', requireAuth, (req, res) => {
  res.render('dashboard.liquid', { posts: [] })
})

server.get('/login', (req, res) => {
  res.render('login.liquid')
})

server.get('/signup', (req, res) => {
  res.render('signup.liquid')
})

server.post('/api/posts', (req, res) => {
  
})

server.put('/api/posts/:id', (req, res) => {

})

server.delete('/api/posts/:id', (req, res) => {

})

server.post('/api/posts/:id', (req, res) => {

})

server.post('/api/login', async (req, res) => {

  const { email, password } = req.body

  const { id, hashedpassword } = db.userByEmail(email)
  if (!id) return res.sendStatus(404) 

  if (await bcrypt.compare(password, hashedpassword)) {
    res.cookie('auth', await jwtSignP({ id }, process.env.JWT_SECRET), { httpOnly: true, signed: true })
    return res.sendStatus(200)
  }

  return res.sendStatus(404)
})

server.post('/api/signup', async (req, res) => {

  const { email, password } = req.body

  const hashedpassword = await bcrypt.hash(password, 10 /* salt rounds */)

  try {
    const { id } = db.createUser({ email, hashedpassword })
    res.cookie('auth', await jwtSignP({ id }, process.env.JWT_SECRET), { signed: true, httpOnly: true })
    res.sendStatus(201)
  } catch(e) {
    res.status(400).send('Something went wrong!')
  }
})

module.exports = server
