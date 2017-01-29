# ciscospark-bff

Use a Cisco Spark bot to minimize [robota](https://en.wikipedia.org/wiki/Corv%C3%A9e).

## Usage

`npm install --save ciscospark-bff; node -p 'require("ciscospark-bff")'`

Provides a simple factory method, `listen`, which returns a Promise for a Bot.

### class Bot

* `#consumeAny(eventName, handler)`: easy to register handler(s); for example:

```
listen(...).then((bot) => {
	bot.consumeAny('messages:created', function * echo ({ spark, webhook }) {
		if (webhook.data.personEmail.endsWith('@sparkbot.io')) return // ignore
		const message = yield spark.messages.get(webhook.data.id) // async
		yield spark.messages.create(message) // will pick roomId, text
	})
})
```
