
const util = require('util');
const cp = require('child_process')
const fs = require('fs')
const { Liquid } = require('liquidjs')
const marked = require('marked')

const uuid = require('uuid').v4

const db = require('./db')

const SMALL_DELAY = 1000
const BIG_DELAY = SMALL_DELAY * 5 

const writeP = util.promisify(fs.writeFile)
const execP = util.promisify(cp.exec.bind(cp))

let timeoutId

async function main() {
  clearTimeout(timeoutId)
    
  console.log('builder checking...')
  const [ deploy, site, post ] = db.deploys.pull()

  if (!deploy) return bigWait()

  console.log('builder found a deploy!', deploy)

  const { siteId } = deploy

  try { 

    const siteDir = `${process.env.SITES_DIR}/${site.handle}`
    const themeDir = `${process.env.THEMES_DIR}/${site.themeId || 'base'}`

    await execP(`rm -rf ${siteDir}`)
    await execP(`mkdir -p ${siteDir}/posts`)
    await execP(`mkdir -p ${siteDir}/pages`)

    function sluggify(str) {
      return str.toLowerCase().replace(/\W/g, '-')
    }

    const engine = new Liquid({
      root: themeDir,
    })

    engine.registerFilter('sluggify', sluggify)
    engine.registerFilter('markdown', marked)

    const PER_PAGE = 2

    async function renderIndexPage(page) {

      const [ posts, hasMore ] = db.posts.getPage({ siteId, offset: page * PER_PAGE, limit: PER_PAGE })

      await engine.renderFile('index.liquid', { 
        site, 
        posts, 
        nextPage: hasMore && page + 2, 
        prevPage: page > 0 && page - 1 
      }).then(output => {
        const name = page === 0 ? 'index.html' : `pages/${page + 1}.html`
        return writeP(`${siteDir}/${name}`, output)
      })

      for (const post of posts) {
        await engine.renderFile('post.liquid', {
          post,
          site
        }).then(async (output) => {
          await writeP(`${siteDir}/posts/${sluggify(post.publishedTitle)}.html`, output)
        })
      }

      return hasMore && renderIndexPage(page + 1)
    }

    // render index pages
    await renderIndexPage(0)
    
    // render feed
    
    // render about page

    // render posts

    smallWait()
  } catch(e) {
    console.log('Deploy failed', e.message)
    bigWait()
  }
}

const bigWait = () => timeoutId = setTimeout(main, BIG_DELAY)
const smallWait = () => timeoutId = setTimeout(main, SMALL_DELAY)

main()

