/* eslint-env es6, mocha, node */
const config = require('config')

const Spark = require('..')

describe('Bot', () => {

	it('can get a Person (me)', () => {
		const credentials = config.get('spark.credentials')
		return new Spark.Bot(credentials).people.get('me').then((me) => {
			me.should.have.property('type', 'bot')
		})
	})

})
