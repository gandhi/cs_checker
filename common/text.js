// Load the twilio module
const twilio = require('twilio');
const config = require('../config');
const bookshelf = require('../bookshelf');
const getNewGradesString = require('./email').getNewGradesString;

const client = new twilio.RestClient(config.sid, config.token);

// Create a new REST API client to make authenticated requests against the
// twilio back end
async function sendText(id) {
    const users = await bookshelf.knex('users').where('id', id);
    const user = users[0];
    const phoneNumber = user.phone_number;
    const message = await getNewGradesString(id);
    client.sms.messages.create({
        to: phoneNumber,
        from: config.phone,
        body: `Your CS grades have changed!\n${message[1]}`
    }, (error, resp) => {
        // The HTTP request to Twilio will run asynchronously. This callback
        // function will be called when a response is received from Twilio
        // The "error" variable will contain error information, if any.
        // If the request was successful, this value will be "falsy"
        if (!error) {
            // The second argument to the callback will contain the information
            // sent back by Twilio for the request. In this case, it is the
            // information about the text messsage you just sent:
            console.log('Success! The SID for this SMS message is:');
            console.log(resp.sid);

            console.log('Message sent on:');
            console.log(resp.dateCreated);
        } else {
            console.log('Oops! There was an error.');
        }
    });
}

module.exports = { sendText };
