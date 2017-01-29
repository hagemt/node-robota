/* eslint-env es6, node */
const _ = require('lodash')
const ngrok = require('ngrok')

const listen = require('.')

if (!module.parent) {
	const port = process.env.PORT || 8080
	const token = process.env.CISCOSPARK_ACCESS_TOKEN
	new Promise((resolve, reject) => {
		ngrok.connect({ addr: port, proto: 'http' }, (ngrokError, targetUrl) => {
			if (ngrokError) return reject(ngrokError) // fatal: no valid webhook
			const webhook = { name: 'example', targetUrl } // via tunnel
			listen({ port, token, webhook }).then(resolve, reject)
		})
	})
	.then((bot) => {
		bot.consumeAny('messages:created', function * echo ({ spark, webhook }) {
			bot.log.info({ data: webhook.data, webhook: _.omit(webhook, 'data') }, 'echo')
			if (_.get(webhook, 'data.personEmail', '').endsWith('@sparkbot.io')) return
			const message = yield spark.messages.get(_.get(webhook, 'data.id'))
			yield spark.messages.create(message) // will persist text, roomId
		})
		bot.people.get('me').then((me) => {
			bot.log.info({ person: me }, 'identity')
		})
	}, (reason) => {
		console.error(reason) // eslint-disable-line no-console
		process.exit(1)
	})
}
