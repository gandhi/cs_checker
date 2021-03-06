const auth = require('../common/authentication');
const crypt = require('../common/encryption');
const script = require('../grade_server_api/scriptRequest');
const db = require('../common/db');
const knex = require('../config/knex.js');

/**
 * GET /contact
 */
function signupGet(req, res) {
    res.render('signup', {
        title: 'Contact'
    });
}

/**
 * POST /contact
 */
async function signupPost(req, res) {
    const email = req.body.email;
    const password = req.body.password;
    const sameEmail = await knex('users').where({ email });
    const sameUMDIds = await knex('users').where({ directory_id: req.body.umdusername });
    let toRegen = false;
    let msg;
    if (!(password.length >= 6 && /\d+/.test(password) && /[a-zA-Z_]+/.test(password))) {
        toRegen = true;
        msg = `Password must be at least 6 characters and contain a number and a letter.`;
    }
    try {
        await script.loginToGradeServer(req.body.umdusername, req.body.umdpass);
    } catch (e) {
        toRegen = true;
        msg = `Incorrect login for ${req.body.umdusername}`;
    }
    if (sameEmail.length !== 0 || sameUMDIds.length !== 0) {
        toRegen = true;
        msg = `Either email or UMD ID already in use.`;
    }
    if (toRegen) {
        req.session.regenerate(() => {
            req.flash('success', { msg: msg });
            res.render('signup', {
                email: req.body.email,
                directory_id: req.body.umdusername
            });
        });
        return;
    }
    auth.hash(password, (err, salt, hash) => {
        if (err) throw err;
        db.createUser({
            email,
            password_salt: salt.toString('base64'),
            password_hash: hash.toString('base64'),
            getsEmails: true,
            getsTexts: false,
            validCredentials: true,
            directory_id: req.body.umdusername,
            directory_pass: crypt.encrypt(req.body.umdpass)
        }).then(newUser => {
            if (err) throw err;
            auth.authenticate(newUser.email, password, (err2, user) => {
                if (err2) throw err2;
                if (user) {
                    req.session.regenerate(() => {
                        req.session.user = user;
                        req.flash('success', { msg: `Information saved for ${req.body.email}` });
                        res.redirect('/profile');
                    });
                }
            });
        });
    });
}

module.exports = { signupPost, signupGet };
