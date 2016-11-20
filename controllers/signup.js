var User = require('../models/user');
var Grade = require('../models/grade');
var nodemailer = require('nodemailer');
var auth = require('../public/js/authentication');
var exec = require('child_process').exec;

/**
 * GET /contact
 */
exports.signupGet = function(req, res) {
  res.render('signup', {
    title: 'Contact'
  });
};

/**
 * POST /contact
 */
exports.signupPost = function(req, res) {
    var courses = req.body.courses.split(',').map(function(str) {
        return str.trim();
    });
    var email = req.body.email;
    var password = req.body.password;
    var callStr = 'node ./script.js ' + req.body.umdusername + ' ' + req.body.umdpass + ' ' + 'LOGINONLY';
    exec(callStr, function(error, stdout, stderr) {
        console.log('stdout: ', stdout);
        if (stderr === "ERROR LOGGING IN") {
            console.log('exec error: ', stderr);
            req.session.regenerate(function(){
                req.flash('success', { msg: 'Incorrect login for ' + req.body.umdusername });
                res.redirect('/signup');
            });
        } else {
            auth.hash(password, function (err, salt, hash) {
                if (err) throw err;
                var user = new User({
                    email: email,
                    password_salt: salt,
                    password_hash: hash.toString('base64'),
                    phone_number: req.body.phoneNumber,
                    directory_id: req.body.umdusername,
                    directory_pass: req.body.umdpass
                }).save().then(function(newUser) {
                    if (err) throw err;
                    var id = newUser.get('id');
                    courses.forEach(function(course) {
                        new Grade({
                            user_id: id,
                            course_code: course,
                            grade: 0.0
                        }).save();
                    });
                    auth.authenticate(newUser.get('email'), password, function(err, user){
                        if(user){
                            req.session.regenerate(function(){
                                req.session.user = user;
                                req.flash('success', { msg: 'Information saved for ' + req.body.email });
                                res.redirect('/signup');
                            });
                        }
                    });
                });
            });
        }
    });
};
