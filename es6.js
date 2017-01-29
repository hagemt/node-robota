/* eslint-env es6, node */
const OpenSSL = require('crypto')
const EventEmitter = require('events')
const HTTP = require('http')

const _ = require('lodash')
const Bunyan = require('bunyan')
const co = require('co')
const parse = require('co-body')
const request = require('request')

const packageJSON = require('./package.json')
const defaults = { event: 'all', resource: 'all' }

const consumer = (fn, done) => (...args) => co(fn, ...args).then(done, done)
const rootLogger = Bunyan.createLogger({ name: packageJSON.name }) // level?

const listen = ({ spark: { credentials, webhook } }, ...args) => {
	const bot = new SparkBot(credentials) // will throw w/o access_token
	const secret = OpenSSL.randomBytes(32).toString('base64') // nonce
	const options = Object.assign({ secret }, defaults, webhook)
	return bot.listenWebhook(options, ...args).then(() => bot)
}

class ResponseError extends Error {
	constructor (responseObject) {
		const statusCode = _.get(responseObject, 'statusCode')
		super(HTTP.STATUS_CODES[statusCode] || 'unknown status')
		Object.defineProperty(this, 'response', { value: responseObject })
		Object.freeze(this)
	}
}

const send = (sendRequest, requestObject) => new Promise((resolve, reject) => {
	sendRequest(requestObject, (requestError, responseObject, body) => {
		if (!requestError && responseObject.statusCode === 200) resolve(body)
		else reject(requestError || new ResponseError(responseObject))
	})
})

/*

// pulls in too many dependencies:
const Client = require('ciscospark')

class CiscoSpark {

	constructor ({ client, events, log: parentLogger = rootLogger }) {
		const childLogger = parentLogger.child({ component: 'Spark' })
		Object.assign({ client, events, log: childLogger })
	}

	static createClient (...args) {
		return Client.init(...args)
	}

}

*/

class RequestSpark {

	constructor ({ client, events, log: parentLogger = rootLogger }) {
		const childLogger = parentLogger.child({ component: 'spark' })
		const [messages, people, rooms, webhooks] = [{}, {}, {}, {}]
		messages.create = (...args) => this.createMessage(...args)
		messages.get = (...args) => this.getMessage(...args)
		people.get = (...args) => this.getPerson(...args)
		rooms.get = (...args) => this.getRoom(...args)
		webhooks.create = (...args) => this.createWebhook(...args)
		webhooks.list = (...args) => this.listWebhooks(...args)
		webhooks.update = (...args) => this.updateWebhook(...args)
		Object.assign(this, { messages, people, rooms, webhooks })
		Object.assign(this, { client, events, log: childLogger })
	}

	createMessage (...args) {
		const body = _.pick(Object.assign({}, ...args), 'roomId', 'text')
		return send(this.client, { body, method: 'POST', uri: 'messages' })
	}

	createWebhook (body) {
		return send(this.client, { body, method: 'POST', uri: 'webhooks' })
	}

	getMessage (id) {
		return send(this.client, { method: 'GET', uri: `messages/${id}` })
	}

	getPerson (id) {
		return send(this.client, { method: 'GET', uri: `people/${id}` })
	}

	getRoom (id) {
		return send(this.client, { method: 'GET', uri: `rooms/${id}` })
	}

	listWebhooks () {
		return send(this.client, { method: 'GET', uri: 'webhooks' })
	}

	updateWebhook (id, body) {
		return send(this.client, { body, method: 'PUT', uri: `webhooks/${id}` })
	}

	static createClient (...args) {
		const credentials = Object.assign({}, ...args)
		const token = _.get(credentials, 'access_token')
		if (!token) throw new TypeError('credentials missing access_token')
		return request.defaults({
			baseUrl: 'https://api.ciscospark.com/v1/',
			headers: {
				Authorization: `Bearer ${token}`,
			},
			json: true,
		})
	}

}

class SparkBot extends RequestSpark {

	constructor (...args) {
		const client = RequestSpark.createClient(...args)
		super({ client, events: new EventEmitter() })
		this.events.on('error', (error, handler) => {
			this.log.warn(error, `from ${handler.name}`)
		})
	}

	consumeAny (eventName, eventHandler) {
		const eventConsumed = (result) => {
			if (result instanceof Error) this.events.emit('error', result, eventHandler)
			else this.log.info({ result }, `${eventHandler.name} consumed ${eventName} event`)
		}
		this.events.on(eventName, consumer(eventHandler, eventConsumed))
		return this
	}

	listenWebhook (webhook, ...args) {
		const alias = _.get(webhook, 'name')
		const secret = _.get(webhook, 'secret')
		if (!alias || !secret) {
			return Promise.reject(new Error('webhooks name/secret required'))
		}
		return this.webhooks.list()
			.then(({ items: oldWebhooks }) => {
				const updates = _.filter(oldWebhooks, { name: alias })
					.map(({ id }) => this.webhooks.update(id, webhook))
				if (updates.length > 0) {
					return Promise.all(updates)
						.then(() => this.webhooks.list())
				}
				return this.webhooks.create(webhook)
					.then(() => this.webhooks.list())
			})
			.then(({ items: newWebhooks }) => {
				this.log.info({ webhooks: newWebhooks }, 'ready')
				const server = HTTP.createServer((req, res) => {
					const { method, url } = req // debug only?
					this.log.info({ method, url }, 'request')
					co(function * validateSparkWebhook () {
						const text = yield parse.text(req) // raw body; JSON.parse'd and returned
						const digest = OpenSSL.createHmac('sha1', secret).update(text).digest('hex')
						if (digest !== req.headers['x-spark-signature']) { // drop invalid:
							throw new Error('could not validate webhook signature')
						}
						return JSON.parse(text) // should be Object w/ data/event/resource
					})
					.then((webhook) => {
						const eventName = `${_.get(webhook, 'resource')}:${_.get(webhook, 'event')}`
						const triggered = this.events.emit(eventName, { bot: this, webhook })
						this.log.info({ triggered }, 'response')
						res.statusCode = 202
						res.end()
					})
					.catch((reason) => {
						this.log.warn(reason, 'response')
						res.statusCode = 406
						res.end()
					})
				})
				return new Promise((resolve, reject) => {
					server.listen(...args, (listenError) => {
						if (listenError) reject(listenError)
						else resolve(server)
					})
				})
			})
	}

}

Object.assign(listen, { Bot: SparkBot, defaults, log: rootLogger, send })
module.exports = Object.assign(listen, { default: listen })
