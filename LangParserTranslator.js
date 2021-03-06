﻿var querystring = require('querystring');
var cheerio = require('cheerio');
var fs = require('fs');
var os = require("os");
var args = require('yargs').argv;
var settings;
if(fs.existsSync('./settings_copy.js')){
    settings = require('./settings_copy.js');
}
else{
    settings = require('./settings');
}

var deepl = require("./deeplApi.js");
var Entities = require('html-entities').XmlEntities;
var entities = new Entities();
var changes = []; // The changed texts (keys of the json)
var jsonLangFromParsed = {}; // Will contain json files with languages ["en"], ["de"], etc from freshly parsing HTML --> and new translations
var jsonLangFromLoadedFile = {}; // Will contain the same as above, but from the current loaded files
var curVersion = 1;
var newVersion = 1;
var report = "\nDefault language: " + settings.defaultLanguage;

/*
 * Start with node LangParserTranslator --job=parseonly/deeplForMoney --source=en --target=de (fr, es, etc OR: all for all languages!!)
 * --job=parseonly will only parse your HTML files and put them into the JSON of the source language. Ignores the --target then
 * --job=DEEPLCOSTSMONEY will parse AND translate with deepl - this costs money through your deepl API! We don't guarantee that this script works!!
 *
 */


var disclaimer = "THIS NODE.JS DEEPL PARSER IS FREE SOFTWARE UNDER MIT LICENSE (c) EasyRadiology GmbH 2020.\n"
+ "---------------------------------------------------------------------------------------------"
+"\n\n TERMS/CONDITIONS: DEEPL TRANSLATIONS COST MONEY!!! WE ARE NOT LIABLE FOR ERRORS IN THE CODE WHICH MAY"
+"\n\n CAUSE YOU, YOUR COMPANY OR ANY THIRD PARTY FINANCIAL DAMAGES !!!!!!!!!!!!"
+"\n\n BY USING THIS SCRIPT YOU AGREE TO THESE TERMS/CONDITIONS\n\n";


var helptext = "node LangParserTranslator --job=parseonly/DEEPLCOSTSMONEY --source=en --target=de (fr, es, etc OR: all for all languages!!)"
+"\n--job=parseonly: will only parse your HTML files and put them into the JSON of the source language. Ignores the --target"
+"\n--job=DEEPLCOSTSMONEY: will parse AND translate with deepl - this costs money through your deepl API! We don't guarantee that this script works!!"

console.log(disclaimer);

if(args.job != "parseonly" && args.job != "DEEPLCOSTSMONEY" ){
    console.log("Start this program with arguments:  \n\n" + helptext);
    process.exit(1);
}


/*
    1. step: Get the default language into memory from the HTML files
*/

jsonLangFromParsed[settings.defaultLanguage] = parseHtmlFiles();

/*
*   2. step: If the default language JSON language file does not exist, create it now, ELSE load it
*/

var jsonLangFile = {};
jsonLangFile["default"] = getJsonFilename(settings.defaultLanguage);
jsonLangFile[settings.defaultLanguage] = jsonLangFile["default"];

if (!fs.existsSync(jsonLangFile["default"])) {
    jsonLangFromParsed[settings.defaultLanguage]["___version"] = 1;
    fs.writeFileSync(jsonLangFile["default"], 
        stringifyLang(settings.defaultLanguage, jsonLangFromParsed[settings.defaultLanguage]),
        function(err) {
            if (err) {
                return console.log("Error in step 2: " + err);
            }
        });
    console.log("Wrote the default language JSON file!");    
}

var temp = fs.readFileSync(jsonLangFile["default"], 'utf8');
jsonLangFromLoadedFile[settings.defaultLanguage] = temp.toString().replace("EasyRadiology_Language[\"" + settings.defaultLanguage + "\"] = ", "");
    


/*
*   3. step: If translate is enabled, also load all languages and create the jsonLangFromParsed[curLang] object and fill it, if js file present
*/

if(args.job == "DEEPLCOSTSMONEY"){
    readAllJsonFiles();

}

/*
*   4. step: Get changes. If none, exit. Else either just parse newly or 
        translate
*/

trackChanges();
if (changes.length > 0 && args.job == "parseonly") {
    curVersion = parseInt(jsonLangFromLoadedFile[settings.defaultLanguage]["___version"]);
    newVersion = curVersion++;
    jsonLangFromParsed[settings.defaultLanguage]["___version"] = newVersion;
    fs.writeFileSync(jsonLangFile["default"],
    jsonLangFromParsed[settings.defaultLanguage],
    function(err) {

        if (err) {
            return console.log("Write error in step 4: " + err);
        }
    });

    console.log("\n\Parsing finished.");

    if(args.job == "DEEPLCOSTSMONEY"){
        translateToAllLanguages();
        console.log("\n\nTranslating finished.");

    }
    
}
else if(args.job == "DEEPLCOSTSMONEY"){
    translateToAllLanguages();
    console.log("\n\nTranslating finished.");
}
else{
    console.log("\nNothing to do, the texts in the existing JSON file is the same as the HTML files");
    process.exit(0);
}

function readAllJsonFiles(){
    //Cycle through all languages
    for (var i = 0; i < settings.translateTo.length; i++) {

        var curLang = settings.translateTo[i];
        if(!settings.availableLanguages.includes(curLang)){
            continue;
        }
        var pathToLangFile = getJsonFilename(curLang);
        if (fs.existsSync(pathToLangFile)) { //If it exists, load it
            var json = fs.readFileSync(pathToLangFile, 'utf8');
            json = json.toString();
            json = json.replace("EasyRadiology_Language[\"" + curLang + "\"] = ", "");
            jsonLangFromLoadedFile[curLang] = JSON.parse(json);
            jsonLangFromParsed[curLang] = jsonLangFromLoadedFile[curLang]; // Put all input already into the output
        }
        else{
            jsonLangFromParsed[curLang] = {};

        }
    }
}

function translateToAllLanguages() {
    //Cycle through all languages
    for (var i = 0; i < settings.translateTo.length; i++) {

        var curLang = settings.translateTo[i];
        if(curLang == settings.defaultLanguage || !settings.availableLanguages.includes(curLang)){
            continue; // Skip the default lang
        }
        
        var promises = []; 

        for (var key in jsonLangFromParsed[settings.defaultLanguage]) {
            if (jsonLangFromLoadedFile[curLang] &&
                jsonLangFromLoadedFile[curLang].hasOwnProperty(key) &&
                !changes.includes(key)) { // If the other lang has also the same key as English, lets check, if anything was changed
                continue; //Nothing to translate
            }
            
            promises.push(translateText(key, jsonLangFromParsed[settings.defaultLanguage][key], curLang));
            
        }

        Promise.all(promises)
        .then((res) => {

            jsonLangFromParsed[curLang]["___version"] = newVersion; 
            var counter = 0;   
            for (var key in jsonLangFromParsed[settings.defaultLanguage]) {
                if (jsonLangFromLoadedFile[curLang].hasOwnProperty(key) && !changes.includes(key) || key=="___version") { // If the other lang has also the same key as English, lets check, if anything was changed
                    continue; //Nothing to translate
                }
                report += "\nKey: \"" + key + "\" - " + settings.defaultLanguage + ": " + jsonLangFromParsed[settings.defaultLanguage][key] 
                + curLang + ": " + res[counter]["data"]["translations"][0]["text"]; 

                jsonLangFromParsed[curLang][key] = res[counter]["data"]["translations"][0]["text"]; 
                counter++;              
            }
            //res[0]["data"]["translations"][0]["text"]

            fs.writeFileSync(getJsonFilename(curLang),
            stringifyLang(curLang, jsonLangFromParsed[curLang]),
            
                    function(err) {
    
                        if (err) {
                            return console.log("Error in translateAllLanguages: " + err);
                        }
                    });            

                    
            fs.writeFileSync(settings.commonPathOfJsonFiles + "report.txt",
            report,
            
                    function(err) {
    
                        if (err) {
                            return console.log("Error in translateAllLanguages: " + err);
                        }
                    });
        })
        .catch((e) => {
            console.log("Error: " + e.message);
            // handle errors here
        });


     } 
}


async function translateText(key, text, targetLanguage)
{
    if(key ==="___version" || (typeof text !== 'string')){
        return;
    }

    if(text.trim() == "" || text == "undefined"){
        return false;
    }
    var obj = {
        "target_lang" : targetLanguage.toUpperCase(),
        "source_lang" : settings.defaultLanguage.toUpperCase(),
        "text" : text
    }
    
    return deepl.translate(obj);
}

function getJsonFilename(language){
    return settings.commonPathOfJsonFiles + settings.jsonFilePrefix + "_" + language + ".js";
}

function stringifyLang(language, obj){
    return "EasyRadiology_Language[\"" + language +"\"] = " + JSON.stringify(obj, null, 1);
}


/*
 * Parses the HTML files and compares to the JSON lang file, if there are changes
 *
 *
 */
function trackChanges() {
    enJson = jsonLangFromLoadedFile[settings.defaultLanguage].replace("EasyRadiology_Language[\"en\"] = ", "");
    var def = JSON.parse(enJson);
    for (var key in jsonLangFromParsed[settings.defaultLanguage]) {
        if (def.hasOwnProperty(key)) {
            if (jsonLangFromParsed[settings.defaultLanguage][key] === def[key] || key == "___version") {
                continue;
            }

        }
        changes.push(key);
    }
    //console.log("Changes are: " + changes);
}


/*
 * Parses all HTML files into the English JSON in memory (not yet saving)
 *
 */

function parseHtmlFiles() {
    var langObj = {};
    for (var i = 0; i < settings.htmlWithLang.length; i++) {
        var temp = parseFile(settings.commonPathOfHtmlFiles + settings.htmlWithLang[i]);
        for (var key in temp){
            langObj[key] = temp[key];
        }
    }
    return langObj;
}

/*
 * Takes HTML files in English and creates an English json file
 */

function parseFile(file) {
    var toLangObj = {};
    var file2 = fs.readFileSync(file, 'utf8');
    //console.log(file);
    var $ = cheerio.load(file2);
    $("[" + settings.langAttribute + "]").each(function (i, elem) {
        var langItem = $(this).html();
        langItem = langItem.replace(/\\t|\\n|^\s|\\(?=")/g, '');
        langItem = langItem.replace(/\s+/g, " ");
        langItem = entities.decode(langItem);

        toLangObj[$(this).attr(settings.langAttribute)] = langItem.trim();

    });

    return toLangObj;
}


