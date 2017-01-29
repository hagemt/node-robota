/* eslint-env es6, node */
const { createHmac, randomBytes } = require('crypto')
const { createServer } = require('http')
const { EventEmitter } = require('events')

const _ = require('lodash')
const Bunyan = require('bunyan')
//const Client = require('ciscospark')
const co = require('co')
const parse = require('co-body')
const request = require('request')

const rootLogger = Bunyan.createLogger({ name: 'Spark' })

const consumer = (fn, done) => (...args) => co(fn, ...args).then(done, done)

const send = (sendRequest, requestObject) => new Promise((resolve, reject) => {
	sendRequest(requestObject, (requestError, responseObject, body) => {
		if (!requestError && responseObject.statusCode === 200) resolve(body)
		else reject(requestError || new Error(responseObject.statusCode))
	})
})

class RequestSpark {

	constructor ({ client, events, log: parentLogger = rootLogger }, ...args) {
		const childLogger = parentLogger.child(Object.assign({}, ...args))
		const [messages, people, rooms, webhooks] = [{}, {}, {}, {}]
		messages.create = (...args) => this.createMessage(...args)
		messages.get = (...args) => this.getMessage(...args)
		people.get = (...args) => this.getPerson(...args)
		rooms.get = (...args) => this.getRoom(...args)
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

}

// class CiscoSpark w/ same interface, client instanceof require('ciscospark')
const CISCOSPARK_BASE_URL = 'https://api.ciscospark.com/v1/' // always valid?

class SparkBot extends RequestSpark {

	constructor (...args) {
		const credentials = Object.assign({}, ...args)
		const token = _.get(credentials, 'access_token')
		if (!token) throw new TypeError('credentials missing access_token')
		const client = request.defaults({
			baseUrl: CISCOSPARK_BASE_URL,
			headers: {
				Authorization: `Bearer ${token}`,
			},
			json: true,
		})
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
		return this.listWebhooks()
			.then(({ items: oldWebhooks }) => {
				const updates = _.filter(oldWebhooks, { name: alias })
					.map(({ id }) => this.updateWebhook(id, webhook))
				if (updates.length > 0) {
					return Promise.all(updates)
						.then(() => this.listWebhooks())
				}
				return this.createWebhook(webhook)
					.then(() => this.listWebhooks())
			})
			.then(({ items: newWebhooks }) => {
				this.log.info({ webhooks: newWebhooks }, 'ready')
				const server = createServer((req, res) => {
					const { method, url } = req // debug only?
					this.log.info({ method, url }, 'request')
					co(function * validateSparkWebhook () {
						const text = yield parse.text(req) // raw body should be JSON
						const digest = createHmac('sha1', secret).update(text).digest('hex')
						if (digest !== req.headers['x-spark-signature']) {
							throw new Error('could not validate webhook signature')
						}
						return JSON.parse(text) // should be Object w/ data/event/resource
					})
					.then((webhook) => {
						const eventName = `${_.get(webhook, 'resource')}:${_.get(webhook, 'event')}`
						const triggered = this.events.emit(eventName, { spark: this, webhook })
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

const defaults = { event: 'all', resource: 'all' }

const listen = ({ port, token, webhook }, ...args) => {
	const bot = new SparkBot({ access_token: token }, ...args)
	const secret = randomBytes(32).toString('base64') // nonce
	const options = Object.assign({ secret }, defaults, webhook)
	return bot.listenWebhook(options, port).then(() => bot)
}

Object.assign(listen, { Bot: SparkBot, defaults, listen })
module.exports = Object.assign(listen, { default: listen })
