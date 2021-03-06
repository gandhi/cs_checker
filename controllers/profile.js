const bookshelf = require('../bookshelf');
// const logout = require('../controllers/logout');
const encryption = require('../common/encryption');
// var formidable = require('formidable');
const script = require('../grade_server_api/scriptRequest');
const phone = require('phone');
const db = require('../common/db');
/**
 * GET /logout
 */
async function profileGet(req, res) {
    const users = await bookshelf.knex('users').where('email', req.session.user.email);
    const user = users[0];
    const classCodes = await bookshelf.knex('grades').where('user_id', user.id);
    const courses = [];
    classCodes.forEach(course => {
        courses.push(course.course_code);
    });
    res.render('profile', {
        email: req.session.user.email,
        directory_id: req.session.user.directory_id,
        classes: courses,
        phone_number: req.session.user.phone_number,
        getsEmails: req.session.user.getsEmails,
        getsTexts: req.session.user.getsTexts,
        validCredentials: req.session.user.validCredentials
    });
}

async function updateProfile(req, res) {
    if (req.body.newUMDPass !== '' && req.body.newUMDPassRetype !== '') {
        if (req.body.newUMDPass !== req.body.newUMDPassRetype) {
            const classCodes = await bookshelf.knex('grades').where('user_id', req.session.user.id);
            const courses = [];
            classCodes.forEach(course => {
                courses.push(course.course_code);
            });
            res.render('profile', {
                errorMessage: 'Passwords must match!',
                email: req.session.user.email,
                directory_id: req.session.user.directory_id,
                classes: courses,
                phone_number: req.session.user.phone_number,
                getsEmails: req.session.user.getsEmails,
                getsTexts: req.session.user.getsTexts,
                validCredentials: req.session.user.validCredentials
            });
            return;
        }
        const encryptedPass = encryption.encrypt(req.body.newUMDPass);
        await bookshelf.knex('users').where('id', req.session.user.id).update({
            directory_pass: encryptedPass
        });
        try {
            await script.loginToGradeServer(req.session.user.directory_id, req.body.newUMDPass);
            await bookshelf.knex('users').where('id', req.session.user.id).update({
                validCredentials: true
            });
            console.log('logged in successfully with new login');
        } catch (e) {
            console.log('Catch triggered');
            await bookshelf.knex('users').where('id', req.session.user.id).update({
                validCredentials: false
            });
        }
    }
    await bookshelf.knex('users').where('id', req.session.user.id).update({
        getsEmails: req.body.getsEmails ? true : false,
        getsTexts: req.body.getsTexts ? true : false,
        phone_number: phone(req.body.newPhone, 'USA')[0]
    });
    const user = await db.getUser(req.session.user.id);
    await script.checkUser(user, false);
    req.session.regenerate(() => {
        req.session.user = user;
        res.status(200);
        req.flash('success', { msg: `Information saved for ${req.body.email}` });
        res.redirect('/profile');
    });
}

module.exports = { profileGet, updateProfile };
