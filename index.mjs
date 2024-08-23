import express from 'express';
import { ParseServer } from 'parse-server';
import ParseNode from 'parse/node.js';
import path from 'path';
import fs from 'fs';
import axios from 'axios';
import * as Vite from 'vite';
import { MongoClient, ServerApiVersion } from "mongodb";
import Proxy from 'http-proxy';
import { useImportTrades, useGetExistingTradesArray, useUploadTrades } from './src/utils/addTrades.js';
import { currentUser, uploadMfePrices, existingTradesArray, tradesData, existingImports } from './src/stores/globals.js';
import { useGetTimeZone } from './src/utils/utils.js';

const databaseURI = "mongodb+srv://info:WuEQuHxL4xZa62IE@cluster0.be4cj.mongodb.net/Cluster0?retryWrites=true&w=majority&appName=Cluster0";

const client = new MongoClient(databaseURI, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const tradenoteDatabase = process.env.TRADENOTE_DATABASE;

const app = express();
const port = process.env.TRADENOTE_PORT;
const PROXY_PORT = 39482;

// SERVER

let server = null

export let allowRegister = false

const startIndex = async () => {

    const startServer = async () => {
        console.log("\nSTARTING NODEJS SERVER")
        return new Promise(async (resolve, reject) => {
            server = app.listen(port, function () {
                console.log(' -> TradeNote server started on http://localhost:' + port)
            });
            resolve(server)
        })
    }

    const runServer = async () => {
        console.log("\nRUNNING SERVER")
        return new Promise(async (resolve, reject) => {
            if (process.env.NODE_ENV == 'dev') {



                var proxy = new Proxy.createProxyServer({
                    target: { host: 'localhost', port: PROXY_PORT }
                });

                // proxy anything yet-unhandled back to vite
                app.get('*', (req, res) => proxy.web(req, res));

                // proxy hmr ws back to vite
                server.on('upgrade', (req, socket, head) => {
                    if (req.url == '/') proxy.ws(req, socket, head)
                });

                // start our vite dev server
                const vite = await Vite.createServer({ server: { port: PROXY_PORT } });
                vite.listen();
                console.log(" -> Running vite dev server")
                resolve()

            } else {
                app.use(express.static('dist'))
                app.get('*', function (request, response) {
                    response.sendFile(path.resolve('dist', 'index.html'));
                });
                console.log(" -> Running prod server")
                resolve()
            }
        })
    }

    const setupParseServer = async () => {
        console.log("\nSTARTING PARSE SERVER")
        return new Promise(async (resolve, reject) => {
            const serv = new ParseServer({
                databaseURI: databaseURI,
                appId: process.env.APP_ID,
                masterKey: process.env.MASTER_KEY,
                port: port,
                masterKeyIps: ['0.0.0.0/0', '::/0'],
                allowClientClassCreation: false,
                allowExpiredAuthDataToken: false
            });

            // EXPRESS USE
            await serv.start().then(() => {
                app.use('/parse', serv.app);
                console.log(" -> ParseNode server started")
                resolve()
            })
        })
    }

    await startServer()
    await setupParseServer()
    await runServer()

    /*var parseDashboard = new ParseDashboard({
        "apps": [{
            "serverURL": "/parse",
            "appId": process.env.APP_ID,
            "masterKey": process.env.MASTER_KEY,
            "appName": "TradeNote"
        }],
        "trustProxy": true
    });*/



    if (process.env.PARSE_DASHBOARD) app.use('/parseDashboard', parseDashboard)

    //INIT
    //console.log("\nInitializing ParseNode")
    ParseNode.initialize(process.env.APP_ID)
    ParseNode.serverURL = "http://localhost:" + port + "/parse"
    ParseNode.masterKey = process.env.MASTER_KEY

    //API

    app.post("/parseAppId", (req, res) => {
        //console.log("\nAPI : post APP ID")
        res.send(process.env.APP_ID)
    });

    app.post("/registerPage", (req, res) => {
        //console.log("\nAPI : post APP ID")
        //console.log(" REGISTER_OFF "+process.env.REGISTER_OFF)
        res.send(process.env.REGISTER_OFF)
    });

    app.post("/posthog", (req, res) => {
        //console.log("\nAPI : posthog")
        if (process.env.ANALYTICS_OFF) {
            res.send("off")
        } else {
            res.send("phc_FxkjH1O898jKu0yiELC3aWKda3vGov7waGN0weU5kw0")
        }
    });

    app.post("/updateSchemas", async (req, res) => {
        //console.log("\nAPI : post update schema")

        let rawdata = fs.readFileSync('requiredClasses.json');
        let schemasJson = JSON.parse(rawdata);
        //console.log("schemasJson "+JSON.stringify(schemasJson))

        let existingSchema = []
        const getExistingSchema = await ParseNode.Schema.all()
        //console.log(" -> Get existing schema " + JSON.stringify(getExistingSchema))

        const renameMongoDb = (param1, param2) => {
            return new Promise(async (resolve, reject) => {
                console.log(" -> Renaming class " + param1 + " to " + param2)
                MongoClient.connect(databaseURI).then(async (client) => {
                    console.log("  --> Connected to MongoDB")
                    const connect = client.db(tradenoteDatabase);
                    const allCollections = await connect.listCollections().toArray()
                    //console.log("allCollections "+JSON.stringify(allCollections))
                    let collectionExists = allCollections.filter(obj => obj.name == param1)
                    //console.log("  --> collectionExists "+collectionExists.length)
                    if (collectionExists.length > 0) {
                        const collection = connect.collection(param1);
                        collection.rename(param2).then(() => {
                            console.log(" -> Renamed class successfully");
                            resolve()
                        })
                    } else {
                        console.log(" -> Collection doesn't exist.")
                        resolve()
                    }

                }).catch((err) => {
                    console.log(" -> Error renaming MongoDB class: " + err.Message);
                    reject()
                })
            })
        }
        for (let i = 0; i < getExistingSchema.length; i++) {
            //console.log("Class name " + getExistingSchema[i].className)

            //we check for classes/collections that need to be renamed
            if (getExistingSchema[i].className == "setupsEntries" || getExistingSchema[i].className == "journals") {
                let oldName = getExistingSchema[i].className
                let newName

                if (getExistingSchema[i].className == "setupsEntries") newName = "screenshots"
                if (getExistingSchema[i].className == "journals") newName = "diaries"
                if (getExistingSchema[i].className == "patternsMistakes") newName = "setups"

                await renameMongoDb(oldName, newName)
            } else {
                existingSchema.push(getExistingSchema[i].className)
            }
        }
        //console.log(" -> Existing Schema " + existingSchema)

        const updateSaveSchema = (param1, param2, param3) => {
            return new Promise((resolve, reject) => {
                const mySchema = new ParseNode.Schema(param1);
                if (param2[param3].type === "String") mySchema.addString(param3)
                if (param2[param3].type === "Number") mySchema.addNumber(param3)
                if (param2[param3].type === "Boolean") mySchema.addBoolean(param3)
                if (param2[param3].type === "Date") mySchema.addDate(param3)
                if (param2[param3].type === "File") mySchema.addFile(param3)
                if (param2[param3].type === "GeoPoint") mySchema.addGeoPoint(param3)
                if (param2[param3].type === "Polygon") mySchema.addPolygon(param3)
                if (param2[param3].type === "Array") mySchema.addArray(param3)
                if (param2[param3].type === "Object") mySchema.addObject(param3)
                if (param2[param3].type === "Pointer") mySchema.addPointer(param3, param2[param3].targetClass)
                if (param2[param3].type === "Relation") mySchema.addRelation(param3, param2[param3].targetClass)

                //console.log("existing schema "+existingSchema)
                //console.log("includes ? "+existingSchema.includes(className))

                //If ParseNode (existing) schema includes the class name from required classes then update (just in case). Else add, and then add that class to existing schema array
                if (existingSchema.includes(param1)) {
                    mySchema.update().then((result) => {
                        console.log("  --> Updating field " + param3)
                        //console.log(" -> Updated schema " + JSON.stringify(result))
                        resolve()
                    })
                } else {
                    mySchema.save().then((result) => {
                        //console.log(" -> Save new schema " + JSON.stringify(result))
                        console.log("  --> Saving field " + param3)
                        existingSchema.push(param1) // Once saved, we update for the rest of the fields, so we need to push to existingSchema
                        //console.log(" -> Existing Schema " + existingSchema)
                        resolve()
                    })
                }
            })
        }

        for (let i = 0; i < schemasJson.length; i++) {
            //console.log("el " + schemasJson[i].className)
            let className = schemasJson[i].className
            console.log(" -> Upsert class/collection " + className + " in ParseNode Schema")
            let obj = schemasJson[i].fields
            for (const key of Object.keys(obj)) {
                //console.log(key, obj[key]);
                if (key != "objectId" && key != "updatedAt" && key != "createdAt" && key != "ACL") {
                    //console.log(" -> Key " + key)
                    await updateSaveSchema(className, obj, key)
                }

            }
        }

        res.send({ "existingSchema": existingSchema })


    })

    /******************************************
     * REST API
     ******************************************/
    app.use(express.json());

    let allUsers
    const getAllUsers = async () => {
        console.log(" -> Getting all users")
        return new Promise(async (resolve, reject) => {
            const parseObject = ParseNode.Object.extend("_User");
            const query = new ParseNode.Query(parseObject);
            const results = await query.find({ useMasterKey: true });
            allUsers = JSON.parse(JSON.stringify(results))
            resolve()
        })
    }

    const validateApiKey = async (req, res, next) => {
        await getAllUsers()
        const targetKey = req.headers['api-key'] || req.query['api-key'];
        //console.log(" -> target Key " + targetKey)
        
        const checkIPKey = (allUsers, targetKey) => {
            for (const user of Object.values(allUsers)) {
                if (user.hasOwnProperty("apis")) {
                    const index = user.apis.findIndex(obj => obj.key === targetKey);
                    if (index !== -1) {
                        currentUser.value = user
                        return true;
                    }
                }

            }
            return -1; // Return -1 if not found
        }

        // Usage example
        const hasIPKey = checkIPKey(allUsers, targetKey);

        if (hasIPKey) {            
            console.log(" -> Valid api key found :)")
            next();
        } else {
            console.log(" -> Invalid api key")
            return res.status(401).send({ error: 'Invalid API key' });
        }
    }

    app.post('/api/trades', validateApiKey, async (req, res) => {
        const data = req.body;
        try {
            if (data && !data.data.length > 0) {
                res.status(200).send(" -> No trades to import");
            }
            else {

                uploadMfePrices.value = data.uploadMfePrices

                //console.log(" uploadMfePrices "+uploadMfePrices.value)
                // Call the function from addTrades.js

                await useGetTimeZone()
                await useGetExistingTradesArray("api", ParseNode)
                await useImportTrades(data.data, "api", data.selectedBroker, ParseNode)
                await useUploadTrades("api", ParseNode)

                res.status(200).send(" -> Saved Trades to ParseNode DB");
            }
        } catch (error) {
            console.error(error);
            res.status(500).send({ error: 'Error creating executions' });
        }
    });

    app.post('/api/databento', async (req, res) => {
        //console.log(" calling databento")
        const data = req.body;
        //console.log(" data "+JSON.stringify(data))
        try {
            const username = data.username;
            const password = '';


            let config = {
                method: 'post',
                maxBodyLength: Infinity,
                url: "https://hist.databento.com/v0/timeseries.get_range",
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(username + ':' + password).toString('base64')
                },
                data: data
            };

            let responseBack
            axios.request(config)
                .then((response) => {
                    //console.log("\n -> Resp " + response.data)
                    responseBack = response.data
                    res.status(200).send(responseBack);
                })
                .catch((error) => {
                    console.log(error);
                    res.status(500).send({ error: error });
                });

        } catch (error) {
            console.error(error);
            res.status(500).send({ error: error });
        }
    })

}

startIndex()
