
const fs = require('fs');
const util = require('util');
const cp = require('child_process')

const uuid = require('uuid').v4

const db = require('./db')

const SMALL_DELAY = 1000
const BIG_DELAY = SMALL_DELAY * 5 

const execP = util.promisify(cp.exec.bind(cp))
const writeP = util.promisify(fs.writeFile)

let timeoutId

async function main() {
  clearTimeout(timeoutId)

  let listen = null
    
  console.log('builder checking...')
  const [ deploy, site, post ] = db.deploys.pull()

  if (deploy) {
    console.log('builder found a deploy!')
    try {

      const { postId, siteHandle, themeId } = deploy

      // clean up
      await execP(`rm -rf ${__dirname}/themes/${themeId}/_posts/*`)
      await execP(`rm -rf ${__dirname}/themes/${themeId}/_site/*`)

      // write post
      await writeP(`${__dirname}/themes/${themeId}/_posts/2020-07-10-${post.title.replace(/\W/g, '-')}.md`, `---
layout: "post"
title:  "${post.title}"
---

${post.content}
    `)

      // build!
      await execP(`cd ${__dirname}/themes/${themeId} && bundle exec jekyll build`)

      // move files into place
      await execP(`mkdir -p ${process.env.SITES_DIR}/sites/${siteHandle}`)
      await execP(`cp -r ${__dirname}/themes/${themeId}/_site/* ${process.env.SITES_DIR}/${siteHandle}`)

      console.log('marking as published', post)
      db.posts.markAsPublished(post)

      smallWait()
    } catch(e) {
      console.log('Deploy failed', e.message)
      bigWait()
    }
  } else {
    bigWait()
  }
}

const bigWait = () => timeoutId = setTimeout(main, BIG_DELAY)
const smallWait = () => timeoutId = setTimeout(main, SMALL_DELAY)

main()

