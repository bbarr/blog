
const DEPLOY = 'deploy'
const WRITE_POST = 'write-post'
const WRITE_SETTINGS = 'write-settings'
const WRITE_PERMISSIONS = 'write-permissions'
const INVITE = 'invite'
const CREATE_SITE = 'create-site'

const ownerPermissions = [ DEPLOY, WRITE_POST, WRITE_SETTINGS, WRITE_PERMISSIONS, INVITE ]
const writerPermissions = [ DEPLOY, WRITE_POST ]

module.exports = {

  forOwner() {
    return ownerPermissions.join(',')
  },

  forWriter() {
    return writerPermissions.join(',')
  }
}
