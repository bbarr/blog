
const fs = require('fs')
const cp = require('child_process')
const { promisify } = require('util')

const db = require('./db')

const writeP = promisify(fs.writeFile)
const unlinkP = promisify(fs.unlink)
const accessP = promisify(fs.access)
const execP = promisify(cp.exec)

const api = {

  // delete file if it is deployed
  // delete db record
  // deploy
  async deletePost({ id, siteId, userId }) {
    const post = db.posts.byId(id)
    if (post.latestPublishedAt) {
      await api.unpublishPost({ id, siteId })
    }
    db.posts.delete({ id, userId })
  },

  // copy post from db to file
  // deploy
  async publishPost({ id, siteId }) {

    const site = db.sites.byId(siteId)
    const sitePath = `${process.env.SITES_DIR}/${site.handle}`

    await execP(`mkdir -p ${sitePath}/_data`)
    await execP(`mkdir -p ${sitePath}/posts`)

    const post = db.posts.byId(id)
    const publishedTitle = post.publishedTitle || post.title

    await writeP(`${sitePath}/_data/config.json`, `{
    	"title": "${site.name}"
    }`)

    await writeP(`${sitePath}/index.liquid`, `
    	{% for post in collections.post %}
		<a href="{{ post.url }}">{{ post.data.title }}</a>
	{% endfor %}
    `)

    await writeP(`${sitePath}/posts/${publishedTitle.toLowerCase().replace(/\W/g, '-')}.md`, `---
title: "${post.title}"
tags: "post"
date: ${(new Date(post.publishedAt)).toISOString()}
---

${post.content}`)

    db.posts.markAsPublished(post)

    db.deploys.push({ siteId })
  },

  // delete file
  // deploy
  async unpublishPost({ id, siteId }) {
    
    const site = db.sites.byId(siteId)
    const sitePath = `${process.env.CONTENT_DIR}/${site.handle}`
    const post = db.posts.byId(id)
    const publishedTitle = post.publishedTitle || post.title
    const postPath = `${sitePath}/${publishedTitle.toLowerCase().replace(/\W/g, '-')}.md`

    console.log('unlinking ', postPath)
    await unlinkP(postPath)

    db.posts.markAsUnpublished(post)
    console.log('marked as unpublished', post)

    db.deploys.push({ siteId })
  }
}

module.exports = api
