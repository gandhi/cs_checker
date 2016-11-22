var phantom = require('phantom');
var User = require('./models/user');
var Grade = require('./models/grade');

var phInstance;
var sitePage;

/* Necessary */
var username = process.argv[2];
var password = process.argv[3];

/*
 * Flags
 * Currently, we run script.js like 'node script.js username password FLAG'
 * or 'node script.js username password class,class user_id'
 *
 * Current Flags are:
 * LOGINONLY -  If we want to exit after we login. Used when we create an account
 *              and make sure valid UMD credentials are given.
 *
 */
if (process.argv[4] === 'LOGINONLY'){
    var flag = 'LOGINONLY';
} else {
    /*
     * Exit if we have no classes for this user AND are not running any
     * flags.
     */
    var classes = process.argv[4].split(',');
    if (classes.length == 0){
        console.error("NO CLASSES SAVED FOR USER");
        process.exit();
    }
}

phantom.create()
    .then(function(instance) {
        /* Create page */
        console.log("Creating page.");
        phInstance = instance;
        return instance.createPage();
    })
    .then(function(page) {
        /* Open grades page */
        console.log("Created page -> opening grades server page");
        sitePage = page;
        return page.open("https://grades.cs.umd.edu/classWeb/login.cgi");
    })
    .then(function(status) {
        console.log("Status: " + status);
        var obj = {
            username: username,
            password: password
        };
        /* Clicks on sign-in */
        sitePage.evaluate(function(obj) {
            var arr = document.getElementsByTagName("form");
            arr[0].elements["user"].value = obj.username;
            arr[0].elements["password"].value = obj.password;
            document.getElementsByTagName("form")[0].submit.click();
        }, obj);
        /* Waits because it takes time for phantom to change pages. */
        setTimeout(function() {
            return getLinks();
        }, 3000);

        function getLinks() {
            /* Get all the links and check to make sure we actually log in. */
            sitePage.evaluate(function(classes) {
                var newList = {};
                var lst = document.getElementsByTagName("a");
                if (document.body.innerHTML.indexOf('Fatal Error') != -1){
                    /* Returning because I am in the phantom browser right now */
                    return "ERROR LOGGING IN";
                }
                var i;
                classes.forEach(function(classNo) {
                    for (i = 0; i < lst.length; i++) {
                        var curr = lst[i].innerHTML;
                        if (curr.indexOf(classNo) != -1) {
                            newList[classNo] = lst[i].href;
                            break;
                        }
                    }
                });
                return newList;
            }, classes)
            .then(function(result){
                if (result === "ERROR LOGGING IN"){
                    console.error(result);
                    process.exit();
                }
                if (flag && flag === 'LOGINONLY'){
                    console.log("Successful login with flag run.");
                    process.exit();
                }
                getGrades(0, result);
                function getGrades(i, links) {
                    var limit = Object.keys(links).length;
                    var id = setTimeout(function() {
                        if (i != limit) {
                            getGradesForPage(i, links);
                        }
                    }, 1000);
                    Object.keys(links).forEach(function(key) {
                        console.log("Key: " + key + " Value: " + links[key]);
                    });
                    if (i == limit) {
                        console.log("i == limit. done.");
                        phInstance.exit(0);
                        checkWithDB(links);
                    }
                }

                function getGradesForPage(i, links) {
                    var arr = Object.keys(links);
                    sitePage.open(links[arr[i]])
                    .then(function(status) {
                        if (status === 'success') {
                            sitePage.evaluate(function(links, i) {
                                var arr = document.getElementsByTagName('td');
                                links[Object.keys(links)[i]] = arr[arr.length - 3].innerHTML;
                                return links;
                            }, links, i).then(function(links){
                                getGrades((i + 1), links);
                            });
                        }
                    });
                }
                function checkWithDB(grades) {
                    var newClasses = {};
                    var needToSendMessage = false;
                    new User({directory_id: username}).fetch().then(function(user){
                        new Grade({
                                user_id: user.get('id')
                            })
                            .fetchAll()
                            .then(function(gradeRows) {
                                gradeRows.models.forEach(function(base) {
                                    var currCourse = base.get('course_code');
                                    var savedGrade = base.get('grade');
                                    if (savedGrade != parseFloat(grades[currCourse])) {
                                        needToSendMessage = true;
                                        new Grade({
                                            id: base.attributes.id,
                                            user_id: user.get('id'),
                                            course_code: currCourse,
                                            grade: parseFloat(grades[currCourse])
                                        }).save(null, {
                                            method: "update"
                                        });
                                    }
                                });
                            });
                    })
                }
            });
        }
    });
