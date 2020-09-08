
const util = require('util');
const cp = require('child_process')
const { Liquid } = require('liquidjs')

const uuid = require('uuid').v4

const db = require('./db')

const SMALL_DELAY = 1000
const BIG_DELAY = SMALL_DELAY * 5 

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

    const themeDir = `${process.env.THEMES_DIR}/${site.themeId || 'base'}`

    const engine = new Liquid({
      root: themeDir
    })

    const PER_PAGE = 2

    async function renderIndexPage(page) {
      const [ posts, hasMore ] = db.posts.getPage({ siteId, offset: page * PER_PAGE, limit: PER_PAGE })
      console.log('ok!', posts, hasMore)
      await engine.renderFile('index.liquid', { posts }).then(output => console.log(output))
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

