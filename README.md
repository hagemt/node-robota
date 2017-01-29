# robota

Use Cisco Spark to provide [robota](https://en.wikipedia.org/wiki/Corv%C3%A9e).

Exposes extremely low-effort mechanism(s) for implementing personal bot slave(s).

## Basic Usage

`npm install --save robota; node -p 'require("robota")' # or: robota/es{5,6}`

Provides a simple factory method, `listen`, which returns a Promise for a Bot.

The class Bot can `#consumeAny` Spark `resource:event`. (see details below)

In the future, it will likely make sense to support a plug-in Bot system.

## class Bot

The constructor currently requires that `credentials.access_token` is passed.

```
const credentials = { access_token: process.env.CISCOSPARK_ACCESS_TOKEN }
const [name, secret, targetUrl] = [...] // webhook set-up prior to listening
new Bot(credentials).listenWebhook({ name, secret, targetUrl }, process.env.PORT)
```

* `#listenWebhook(webhook, ...args)`: Promises HTTP `Server#listen(...args)`

Additional `webhook` properties include `event`/`resource` and `filter`, etc.

* `#consumeAny(eventName, handler)`: easy to register handler(s); for example:

```
const credentials = { ... } // have to provide access_token (for Spark bot)
const webhook = { ... } // required: name, targetUrl; optional: secret, etc.
listen({ spark: { credentials, webhook } }, process.env.PORT).then((bot) => {
	bot.consumeAny('messages:created', function * echoDirectedMessage (spark) {
		if (spark.webhook.data.personEmail.endsWith('@sparkbot.io')) return
		const message = yield spark.bot.messages.get(spark.webhook.data.id)
		yield spark.bot.messages.create(message) // will pick roomId, text
	})
})
```

## Integration Notes

P.S. The [`config`](https://www.npmjs.com/package/config) module is awesome.

It can map `process.env` entities and may simplify many large configurations.
