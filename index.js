'use strict'
//const AWS = require('aws-sdk');

var MongoClient = require('mongodb').MongoClient;
var axios = require('axios')

//Performance optimization Step 1: declare the database connection object outside the handler method
let cachedDb = null;

let atlas_connection_uri = 'mongodb+srv://developer:UDtkbZpZibnpxUBl@cluster0.jotyp.mongodb.net/game?retryWrites=true&w=majority';


exports.handler = async(event, context, callback) => {

    return new Promise(async(resolve, reject) => {
        try {
            var uri = process.env['MONGODB_ATLAS_CLUSTER_URI'];

            console.log('remaining time =', context.getRemainingTimeInMillis());
            console.log('functionName =', context.functionName);
            console.log('AWSrequestID =', context.awsRequestId);
            console.log('logGroupName =', context.logGroupName);
            console.log('logStreamName =', context.logStreamName);
            console.log('clientContext =', context.clientContext);

            //Performance optimization Step 2: set context.callbackWaitsForEmptyEventLoop to false to prevent the Lambda function from waiting for all resources (such as the database connection) to be released before returning it
            context.callbackWaitsForEmptyEventLoop = false;

            if (atlas_connection_uri == null) {
                atlas_connection_uri = uri;
                /*
                  const kms = new AWS.KMS();
                  kms.decrypt({ CiphertextBlob: new Buffer(uri, 'base64') }, (err, data) => {
                      if (err) {
                          console.log('Decrypt error:', err);
                          return callback(err);
                      }
                      
                      atlas_connection_uri = data.Plaintext.toString('ascii');
                    });
                    */
            }
            let response = await processEvent(event, context, callback);
            resolve(response)

        }
        catch (e) {
            console.log('This is the exception !', e)
            return reject(JSON.stringify(e))
        }
    })
};

function connectToDatabase(uri) {

    //Performance optimization Step 3: test that database connection exists and is valid
    //before re-using it
    if (cachedDb && cachedDb.serverConfig.isConnected()) {
        console.log('=> using cached database instance');
        return Promise.resolve(cachedDb);
    }
    const dbName = 'game';
    return MongoClient.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true })
        .then(client => { cachedDb = client.db(dbName); return cachedDb; });
}

async function processEvent(event, context, callback) {
    return new Promise(async(resolve, reject) => {
        try {
            console.log(atlas_connection_uri)
            let db = await connectToDatabase(atlas_connection_uri);
            console.log(db)
            /**Call a different method when there is get API */
            if (event.requestContext.httpMethod === 'GET' && event.requestContext.resourcePath === '/getscores') {
                let params = event.queryStringParameters;
                let limit = 10;
                let skip = 0;
                if (params) {
                    if (params.limit) {
                        limit = parseInt(params.limit)
                    }
                    if (params.skip) {
                        skip = parseInt(params.skip)
                    }
                }

                let getLeaderBoard = await queryDatabase(db, limit, skip);
                resolve(createResponseObj(200, getLeaderBoard, 'Found all the details !'))
            }
            else if (event.requestContext.httpMethod === 'GET' && event.requestContext.resourcePath === '/getscorebyid') {
                let params = event.queryStringParameters;
                let id;
                if (params) {
                    id = params.id
                }

                if (id === undefined || id === "") {
                    resolve(createResponseObj(400, null, 'Id is a required field !'))
                }
                else {
                    let getUserData = await queryById(db, id);
                    if (getUserData.length > 0) {
                        resolve(createResponseObj(200, getUserData, 'No user found !'))
                    }
                    else {
                        resolve(createResponseObj(400, null, 'No user found !'))
                    }

                }

            }
            else if (event.requestContext.httpMethod === 'POST' && event.requestContext.resourcePath === '/postscore') {
                
                let reqBody = JSON.parse(event.body);
                console.log(reqBody)
                let id = reqBody.id;
                let firstname = reqBody.firstname;
                let lastname = reqBody.lastname;
                let profilePic = reqBody.profilePic;
                let score = reqBody.score;
                let email = reqBody.email;

                let docObject = {
                    "id": id,
                    "email": email,
                    "firstname": firstname,
                    "lastname": lastname,
                    "score": score,
                    "profilePic": profilePic,
                    
                };
                console.log(docObject);

                let response = await addNewUser(db, docObject);
                resolve(response)
            }
            else {
                let response = createResponseObj(400, null, 'Invalid method !')
                resolve(response)
            }

        }
        catch (e) {
            console.log('Exception:', e)
            let response = createResponseObj(500, e, 'Something went wrong !');
            return resolve(e)
        }
    })

}

async function queryDatabase(db, limit, skip) {
    return new Promise(async(resolve, reject) => {
        try {

            let queryResult = db.collection('leaderboard').find({}).sort({ score: -1 }).skip(skip).limit(limit);
            resolve(queryResult.toArray())
        }
        catch (e) {
            reject(e)
        }
    })
}

async function queryById(db, id) {
    return new Promise(async(resolve, reject) => {
        try {

            let queryResult = db.collection('leaderboard').find({ 'id': id }, { _id: 0 }).sort({ score: -1 });
            resolve(queryResult.toArray())
        }
        catch (e) {
            reject(e)
        }
    })

}

async function addNewUser(db, docObject) {
    return new Promise(async(resolve, reject) => {
        try {
            console.log('addUser', docObject);
            /**Before adding the user check if the user exists*/
            let checkIfAUserExistsResult = await checkIfAUserExists(db, docObject.id);
            console.log('checkIfAUserExistsResult',checkIfAUserExistsResult)
            if (checkIfAUserExistsResult.statusCode === 200) {
                /**if it exists then check its score and update*/
                let getFirstUser = JSON.parse(checkIfAUserExistsResult.body)[0];
                console.log('getFirstUser !', getFirstUser);
                console.log(getFirstUser.score, docObject.score);
                if (getFirstUser.score < docObject.score) {
                    let id = docObject.id;
                    let score = docObject.score;
                    let updateScoreResult = await updateScoreForAUser(db, id, score);
                    resolve(updateScoreResult);
                }
                else {
                    resolve(createResponseObj(400, null, 'Already created user !'));
                }

            }
            else if (checkIfAUserExistsResult.statusCode === 205) {
                let castObject = {
                    "id": docObject.id,
                    "firstname": docObject.firstname,
                    "lastname": docObject.lastname,
                    "score": docObject.score,
                    "profilePic": docObject.profilePic,
                    "email": docObject.email
                }

                let newUser = db.collection('leaderboard').save(castObject, { w: 1 });
                resolve(createResponseObj(200, null, 'Successfully created the user !'))
            }
            else {
                reject(checkIfAUserExistsResult)
            }

        }
        catch (e) {
            console.log(e)
            reject(e)
        }
    })

}


async function checkIfAUserExists(db, id) {
    return new Promise(async(resolve, reject) => {
        try {

            let getUser = await db.collection('leaderboard').find({ 'id': id });
            let getUserResult = await getUser.toArray();
            if (getUserResult.length > 0) {
                resolve(createResponseObj(200, getUserResult, 'Founded the user !'));
            }
            else {
                resolve(createResponseObj(205, null, 'No user was found !'))
            }
        }
        catch (e) {
            reject(createResponseObj(500, null, 'User check failed !'))
        }
    })

}

async function updateScoreForAUser(db, id, score) {
    return new Promise(async(resolve, reject) => {
        try {

            let updateUserScore = await db.collection('leaderboard').update({ 'id': id }, { $set: { score: score } });

            console.log('updateUserScore : ', updateUserScore);
            resolve(createResponseObj(200, null, 'Score was updated for the user !'))

        }
        catch (e) {
            reject(createResponseObj(500, null, 'Unable to update score!'))
        }
    })

}

async function createFacebookAppToken() {
    return new Promise(async(resolve, reject) => {
        try {

            let baseUrl = 'https://graph.facebook.com/oauth/access_token';
            let response = await axios.get(baseUrl, {
                params: {
                    grant_type: 'client_credentials',
                    client_id: '392984352054599',
                    client_secret: 'd4186acca66c26c0821ae7f6517ce493'
                }
            })
            let result = {
                statusCode: response.status,
                result: response.data,
                message: 'Successfully fetched the app token !'
            }
            resolve(result)

        }
        catch (exception) {
            console.log(exception)
            reject(createResponseObj(500, null, 'Failed to create app token !'))
        }
    })

}


async function verifyToken(access_token) {
    return new Promise(async(resolve, reject) => {
        try {
            let appTokenResult = await createFacebookAppToken();

            let appToken;
            if (appTokenResult)
                appToken = appTokenResult.result.access_token;

            let baseUrl = 'https://graph.facebook.com/debug_token';
            let response = await axios.get(baseUrl, {
                params: {
                    input_token: access_token,
                    access_token: appToken
                }
            })
            let result = {
                statusCode: response.status,
                result: response.data,
                message: 'Token is verified !'
            }
            resolve(result)

        }
        catch (exception) {
            console.log(exception)
            reject(createResponseObj(500, null, 'verification failed !'))
        }
    })

}

function createResponseObj(statusCode, data, message) {
    let body = JSON.stringify(data);
    let response = {
        "isBase64Encoded": false,
        "statusCode": statusCode,
        "headers": {
            "Access-Control-Allow-Origin": "*"
        },
        "body": body
    }
    return response;
}

