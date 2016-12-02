const phantom = require('phantom');
const User = require('../models/user');
const Grade = require('../models/grade');
const db = require('../common/db');
const bookshelf = require('../bookshelf');
const sendMessage = require('../common/email').sendMessage;
const getUser = require('../common/db').getUser;
const xpath = require('xpath');
const Dom = require('xmldom').DOMParser;
const knex = require('../config/knex');

async function loginToGradeServer(instance, username, password) {
    const page = await instance.createPage();
    const status = await page.open('https://grades.cs.umd.edu/classWeb/login.cgi');
    if (status === 'fail') throw Error('Failed to load grades.cs.umd.edu');

    let loginSucceeded;
    let loginFailed;
    const loginPromise = new Promise(
        (resolve, reject) => {
            loginSucceeded = resolve;
            loginFailed = reject;
        }
    );

    await page.on('onResourceReceived', async () => {
        try {
            const content = await page.property('content');
            if (content.includes('Fatal Error')) throw new Error('Invalid Login');
            loginSucceeded(page);
        } catch (e) {
            loginFailed(e);
        }
    });

    const loginInfo = { username, password };
    await page.evaluate(function (obj) {
        const arr = document.getElementsByTagName('form');
        arr[0].elements.user.value = obj.username;
        arr[0].elements.password.value = obj.password;
        document.getElementsByTagName('form')[0].submit.click();
    }, loginInfo);

    return await loginPromise;
}

async function getCourses(page) {
    await page.open('https://grades.cs.umd.edu/classWeb/login.cgi');
    const content = await page.property('content');
    const doc = new Dom().parseFromString(content);
    const nodes = xpath.select('//a[contains(@href, "viewGrades.cgi?courseID")]', doc);

    return nodes.map(node => {
        const courseMatch = xpath.select('text()', node)[0].data.match(/CMSC(\d\d\d\d?[A-z]?)/);
        return {
            href: xpath.select('@href', node)[0].value,
            course: courseMatch ? courseMatch[1] : null
        };
    });
}

async function getGrade(page, course) {
    await page.open(`https://grades.cs.umd.edu/classWeb/${course.href}`);
    const content = await page.property('content');
    const doc = new Dom().parseFromString(content);
    const nodes = xpath.select('//table//table//tr[last()]/td[2]/text()', doc);

    try {
        return parseFloat(nodes[0].data);
    } catch (e) {
        return null;
    }
}

async function checkUser(user) {
    const courseGrades = {};
    (await db.getUserGrades(user)).forEach(gradeInfo => {
        courseGrades[gradeInfo.course_code] = gradeInfo.grade;
    });
    const instance = await phantom.create();
    let userPage;
    try {
        userPage = await loginToGradeServer(instance, user.directory_id, user.directory_pass);
    } catch (e) {
        console.error(`User ${user.directory_id} has invalid login information!`);
        return;
    }
    const courses = (await getCourses(userPage)).filter(courseInfo =>
        Object.keys(courseGrades).includes(courseInfo.course)
    );

    for (let i = 0; i < courses.length; i++) {
        const courseInfo = courses[i];
        const grade = await getGrade(userPage, courseInfo);
        if (courseGrades[courseInfo.course] !== grade) {
            console.log(`updating ${courseInfo.course} course grade for ${user.directory_id}`);
            await knex('grades').where('user_id', user.id).where('course_code', courseInfo.course).update('grade', grade);
        }
    }
    console.log(`Finished for user ${user.directory_id}`);
    await instance.exit();
}

function doPhantom(username, password, courses) {
    let phInstance;
    let sitePage;
    phantom.create()
        .then(instance => {
            /* Create page */
            console.log("Creating page.");
            phInstance = instance;
            return instance.createPage();
        })
        .then(page => {
            /* Open grades page */
            console.log("Created page -> opening grades server page");
            sitePage = page;
            return page.open("https://grades.cs.umd.edu/classWeb/login.cgi");
        })
        .then(status => {
            console.log("Status: " + status);
            const obj = { username, password };
            /* Clicks on sign-in */
            sitePage.evaluate(function (obj) {
                const arr = document.getElementsByTagName("form");
                arr[0].elements["user"].value = obj.username;
                arr[0].elements["password"].value = obj.password;
                document.getElementsByTagName("form")[0].submit.click();
            }, obj);
            /* Waits because it takes time for phantom to change pages. */


            function getLinks() {
                /* Get all the links and check to make sure we actually log in. */
                sitePage.evaluate(function(courses) {
                    var i;
                    const newList = {};
                    const lst = document.getElementsByTagName('a');
                    if (document.body.innerHTML.indexOf('Fatal Error') !== -1) {
                        /* Returning because I am in the phantom browser right now */
                        return 'ERROR LOGGING IN';
                    }
                    courses.forEach(function(classNo) {
                        for (i = 0; i < lst.length; i ++) {
                            const curr = lst[i].innerHTML;
                            if (curr.indexOf(classNo) !== -1) {
                                newList[classNo] = lst[i].href;
                                break;
                            }
                        }
                    });
                    return newList;
                }, courses)
                .then(result => {
                    if (result === 'ERROR LOGGING IN'){
                        console.error(result);
                        phInstance.exit(0);
                        /*
                         * Need to create flag in DB that will esentially have
                         * a "NEEDS TO UPDATE PW".
                         */
                        process.exit();
                    }

                    function getGradesForPage(i, links) {
                        const arr = Object.keys(links);
                        sitePage.open(links[arr[i]])
                        .then(status => {
                            if (status === 'success') {
                                sitePage.evaluate(function(links, i) {
                                    var arr = document.getElementsByTagName('td');
                                    links[Object.keys(links)[i]] = arr[arr.length - 3].innerHTML;
                                    return links;
                                }, links, i).then(links => {
                                    getGrades((i + 1), links);
                                });
                            }
                        });
                    }

                    function checkWithDB(newGrades) {
                        let needToSendMessage = false;
                        new User({ directory_id: username }).fetch().then(user => {
                            bookshelf.knex('grades').where('user_id', user.get('id')).then(oldGrades => {
                                oldGrades.forEach(base => {
                                    const currCourse = base.course_code;
                                    const savedGrade = base.grade;
                                    if (savedGrade !== parseFloat(newGrades[currCourse])) {
                                        needToSendMessage = true;
                                        /*
                                        console.log("id: " + parseInt(base.id));
                                        console.log("user_id: " + user.get('id'));
                                        console.log("course_code: " + currCourse);
                                        console.log("grade: " + parseFloat(newGrades[currCourse]));
                                        */
                                        new Grade({
                                            id: parseInt(base.id, 10),
                                            user_id: user.get('id'),
                                            course_code: currCourse,
                                            grade: parseFloat(newGrades[currCourse])
                                        }).save(null, {
                                            method: 'update'
                                        });
                                    }
                                });
                            }).then(() => {
                                if (needToSendMessage) {
                                    sendMessage(user.get('id'));
                                }
                            });
                        });
                    }

                    function getGrades(i, links) {
                        const limit = Object.keys(links).length;
                        setTimeout(() => {
                            if (i !== limit) {
                                getGradesForPage(i, links);
                            }
                        }, 1000);
                        Object.keys(links).forEach(key => {
                            console.log('Key: ' + key + ' Value: ' + links[key]);
                        });
                        if (i === limit) {
                            console.log('i == limit. done.');
                            phInstance.exit(0);
                            checkWithDB(links);
                        }
                    }
                    getGrades(0, result);
                });
            }
            setTimeout(() => getLinks(), 3000);
        });
}

function updateUser(username) {
    const courses = [];
    let password;
    bookshelf.knex('users').where('directory_id', username).then(users => {
        const user = users[0];
        getUser(user.id).then(userWithPW => {
            password = userWithPW.directory_pass;
        }).then(() => {
            bookshelf.knex('grades').where('user_id', user.id).then(grades => {
                grades.forEach(grade => {
                    courses.push(grade.course_code);
                });
            }).then(() => {
                doPhantom(username, password, courses);
            });
        });
    });
}

module.exports = { updateUser, checkUser, loginToGradeServer, getCourses, getGrade };
