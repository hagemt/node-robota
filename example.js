/* eslint-env es6, node */
const _ = require('lodash')
const config = require('config')
const ngrok = require('ngrok')

const listen = require('.')

if (!module.parent) {
	// can use process.env to override any of these settings:
	const port = config.get('server.port') // see config/defaults.json5
	const credentials = config.get('spark.credentials') // holds access_token
	// can also specify CISCOSPARK_WEBHOOK_NAME and CISCOSPARK_WEBHOOK_SECRET
	new Promise((resolve, reject) => {
		// ngrok is only necessary to tunnel the webhook req/res to/from localhost:
		ngrok.connect({ addr: port, proto: 'http' }, (ngrokError, targetUrl) => {
			if (ngrokError) return reject(ngrokError) // fatal: no valid route for
			const webhook = { name: 'example', targetUrl } // tunnel'd to localhost
			listen({ spark: { credentials, webhook } }, port).then(resolve, reject)
		})
	})
	.then((bot) => {
		bot.consumeAny('messages:created', function * echoMessage (spark) {
			const webhook = _.get(spark, 'webhook', {}) // has data w/ message id, etc.
			const personEmail = _.get(webhook, 'data.personEmail', '') // email address
			if (personEmail.endsWith('@sparkbot.io')) return 'ignored message' // filter
			const data = _.omit(_.get(webhook, 'data', {}), 'personEmail') // sanitized
			bot.log.info({ data, webhook: _.omit(webhook, 'data') }, echoMessage.name)
			const message = yield spark.bot.messages.get(data.id) // roomId, text, etc.
			return yield spark.bot.messages.create(message).then(() => 'posted message')
		})
		// sanity-check, to identity Bot:
		bot.people.get('me').then((me) => {
			bot.log.info({ person: me }, 'identity')
		})
	}, (reason) => {
		console.error(reason) // eslint-disable-line no-console
		process.exit(1)
	})
}
