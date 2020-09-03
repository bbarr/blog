
const util = require('util');
const cp = require('child_process')

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

  const { siteHandle } = deploy

  try { 
    await execP(`jekyll build --source ${process.env.SITES_DIR}/${siteHandle} --destination ${process.env.SITES_DIR}/${siteHandle}/_site`)
    smallWait()
  } catch(e) {
    console.log('Deploy failed', e.message)
    bigWait()
  }
}

const bigWait = () => timeoutId = setTimeout(main, BIG_DELAY)
const smallWait = () => timeoutId = setTimeout(main, SMALL_DELAY)

main()
