
const fs = require('fs')
const { promisify } = require('util')

const db = require('./db')

const writeP = promisify(fs.writeFile)
const unlinkP = promisify(fs.unlink)

const api = {

  // delete file if it is deployed
  // delete db record
  // deploy
  async deletePost({ id, siteHandle, userId }) {
    const post = db.posts.byId(id)
    if (post.latestPublishedAt) {
      await api.unpublishPost({ id, siteHandle })
    }
    db.posts.delete({ id, userId })
  },

  // copy post from db to file
  // deploy
  async publishPost({ id, siteHandle }) {
    const sitePath = `${process.env.SITES_DIR}/${siteHandle}`
    const post = db.posts.byId(id)
    const date = new Date(post.latestPublishedAt || (new Date()).toISOString())
    const postPath = `${sitePath}/_posts/${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${post.title.replace(/\W/g, '-')}.md`

    await writeP(postPath, `---
layout: "post"
title:  "${post.title}"
---

${post.content}`)

    db.posts.markAsPublished(post)

    db.deploys.push({ siteHandle })
  },

  // delete file
  // deploy
  async unpublishPost({ id, siteHandle }) {
    
    const sitePath = `${process.env.SITES_DIR}/${siteHandle}`
    const post = db.posts.byId(id)
    const date = new Date(post.latestPublishedAt || (new Date()).toISOString())
    const postPath = `${sitePath}/_posts/${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}-${post.title.replace(/\W/g, '-')}.md`

    console.log('unlinking ', postPath)
    await unlinkP(postPath)

    db.posts.markAsUnpublished(post)
    console.log('marked as unpublished', post)

    db.deploys.push({ siteHandle })
  }
}

module.exports = api
