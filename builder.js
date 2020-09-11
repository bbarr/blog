
const util = require('util');
const cp = require('child_process')
const fs = require('fs')
const { Liquid } = require('liquidjs')
const sass = require('node-sass')

const marked = require('marked')

const uuid = require('uuid').v4

const db = require('./db')

const SMALL_DELAY = 1000
const BIG_DELAY = SMALL_DELAY * 5 

const renderSassP = util.promisify(sass.render)
const writeP = util.promisify(fs.writeFile)
const readP = util.promisify(fs.readFile)
const execP = util.promisify(cp.exec.bind(cp))

let timeoutId

async function main() {
  clearTimeout(timeoutId)
    
  console.log('builder checking...')
  const [ deploy, site ] = db.deploys.pull()

  if (!deploy) return bigWait()

  console.log('builder found a deploy!', deploy)

  const { siteId } = deploy

  try { 

    const siteDir = `${process.env.SITES_DIR}/${site.handle}.${process.env.HOSTNAME}`
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

    const PER_PAGE = 10

    async function renderIndexPage(page) {

      const [ posts, hasMore ] = db.posts.getPage({ siteId, offset: page * PER_PAGE, limit: PER_PAGE })

      const rendered = await renderSassP({ file: `${themeDir}/style.scss`, includePaths: [ 'node_modules/', themeDir ] })
      const css = rendered.css.toString()

      await engine.renderFile('index.liquid', { 
        site, 
        posts, 
        css,
        nextPage: hasMore && page + 2, 
        prevPage: page > 0 && page - 1 
      }).then(output => {
        const name = page === 0 ? 'index.html' : `pages/${page + 1}.html`
        return writeP(`${siteDir}/${name}`, output)
      })

      for (const post of posts) {
        await engine.renderFile('post.liquid', {
          post,
          site,
          css
        }).then(async (output) => {
          await writeP(`${siteDir}/posts/${sluggify(post.publishedTitle)}.html`, output)
        })
      }

      return hasMore && renderIndexPage(page + 1)
    }

    async function renderFeedPage() {

      const [ posts, _ ] = db.posts.getPage({ siteId, offset: 0, limit: 10 })

      const str = `
        <rss version="2.0">
          <channel>
            <title>${site.name}</title>
            <link>https://${site.handle}.${process.env.HOSTNAME}</link>
            <description>${site.description}</description>
            ${posts.map(post => {
              return `
                <item>
                  <title>${post.title}</title>
                  <link>https://${site.handle}.${process.env.HOSTNAME}/posts/${sluggify(post.publishedTitle)}</link>
                  <pubDate>${pubDate(new Date(post.publishedAt))}</pubDate>
                </item>
              `
            }).join('')}
          </channel>
        </rss>
      `

      await writeP(`${siteDir}/feed.xml`, str)
    }

    function pubDate(date) {

      if (typeof date === 'undefined') {
        date = new Date();
      }

      var pieces     = date.toString().split(' '),
          offsetTime = pieces[5].match(/[-+]\d{4}/),
          offset     = (offsetTime) ? offsetTime : pieces[5],
          parts      = [
            pieces[0] + ',',
            pieces[2],
            pieces[1],
            pieces[3],
            pieces[4],
            offset
          ];

      return parts.join(' ');
    }

    // render index pages
    await renderIndexPage(0)
    
    // render feed
    await renderFeedPage(0)
    
    // render about page

    // render posts
  
    if (site.customDomain)
      await execP(`ln -s ${siteDir}/ ${process.env.SITES_DIR}/${site.customDomain}`)

    smallWait()
  } catch(e) {
    console.log('Deploy failed', e.message)
    bigWait()
  }
}

const bigWait = () => timeoutId = setTimeout(main, BIG_DELAY)
const smallWait = () => timeoutId = setTimeout(main, SMALL_DELAY)

main()

