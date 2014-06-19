
/**
 * Module dependencies.
 */

var express = require('express')
  , opener  = require('opener')
  , routes  = require('./routes')
  , artemisNet = require('./artemisNet')
  , artemisModel = require('./public/javascripts/worldmodel');


//Lifx
var lifx = require('./lifxjs/lifx');
var util = require('util');
var packet = require('./lifxjs/packet');
var spawn = require('child_process').spawn
var playerCh1 = null;
var playerCh2 = null;

var currentLight = null;


//Light states
var artemisLight = function(){};

artemisLight.prototype.clone = function(){
	var newLight = new artemisLight();
	newLight.hue = this.hue;
	newLight.sat = this.sat;
	newLight.lum = this.lum;
	newLight.temp = this.temp;
	return newLight;
}

artemisLight.prototype.isEqualLight = function(otherLight){
	if(this.hue == otherLight.hue && this.sat == otherLight.sat && this.lum == otherLight.lum){
		return true;
	}
	return false;
}

artemisLight.prototype.apply = function(fadeTime,overrideCheck){
	if(fadeTime === undefined){
		fadeTime = 0;
	}
	if(overrideCheck === undefined){
		overrideCheck = false;
	}
	if(overrideCheck || currentLight == null || !this.isEqualLight(currentLight)){
		console.log("Lights to Hue:"+this.hue + " Sat:" + this.sat + " Lum:" + this.lum + " Temp:" + this.temp + " Fade:" + fadeTime);
		lx.lightsColour(this.hue, this.sat, this.lum, this.temp, fadeTime);
		
	}else{
		console.log("Lights did not change");
	}
	currentLight = this;
}

var defaultLightState = new artemisLight();
defaultLightState.hue = 37836;
defaultLightState.sat = 0x4fff;
defaultLightState.lum = 0x1000;
defaultLightState.temp = 0x0af0;



var shieldLight = new artemisLight();
shieldLight.hue = 39072;
shieldLight.sat = 0xffff;
shieldLight.lum = 0x8000;
shieldLight.temp = 0;


var redAlertDimLight = new artemisLight();
redAlertDimLight.hue = 0x0000;
redAlertDimLight.sat = 0xffff;
redAlertDimLight.lum = 0x8000;
redAlertDimLight.temp = 0;

var redAlertBrightLight= new artemisLight();
redAlertBrightLight.hue = 0x0000;
redAlertBrightLight.sat = 0xffff;
redAlertBrightLight.lum = 0x1000;
redAlertBrightLight.temp = 0;

var lightState;




lifx.setDebug(false);
var lx = lifx.init();

var firstUpdate = true;
var alertIsBright = false;
var alertIsOn = false;
var shieldsAreUp = false;
var shieldPower = 80;
var maxShieldPower = 80;
var subsystems = {};
var shipDamage = 0;

var clearGameState = function(){
	firstUpdate = true;
	alertIsBright = false;
	alertIsOn = false;
	shieldsAreUp = false;
	shieldPower = 80;
	maxShieldPower = 80;
	subsystems = {};
	shipDamage = 0;
}



var alertIntervalMsec = 1000;


var applyCurrentStateLight = function(fadeTime,overrideCheck){
	var stateLight = null;

	if(!alertIsOn){
		if(shieldsAreUp && shieldPower >= 1){
			stateLight = shieldLight.clone();

			stateLight.lum = Math.round(stateLight.lum*(shieldPower/maxShieldPower));

		}else{
			stateLight = defaultLightState.clone();
			if(shipDamage < 0.10){

			}
			else if(shipDamage > 0.10 && shipDamage <= 0.30){
				stateLight.lum = 0x0400;
			}else if(shipDamage > 0.3 && shipDamage <= 0.50){
				stateLight = redAlertBrightLight.clone();
			}else if(shipDamage > 0.5 && shipDamage <= 0.75){
				stateLight = redAlertDimLight.clone();
			}else{
				if(playerCh2 == null && !alertIsOn){
					playerCh2 = spawn("vlc",["alarm.mp3","-R","--qt-start-minimized","--qt-notification=0"]);
				}
				return;
				//red alert
			}
			if(shipDamage <= 0.75 && !alertIsOn && playerCh2 != null){
				playerCh2.kill();
				playerCh2 = null;
			}
		}

		stateLight.apply(fadeTime,overrideCheck);
	}

}

lx.on('bulb', function(b) {
	console.log("New bulb found. Reapplying lights");
	applyCurrentStateLight(100,true);
});

var alertFunction = function(){
	if(alertIsOn || shipDamage > 0.75){
		if(alertIsBright){
			redAlertDimLight.apply(alertIntervalMsec);
			//lx.lightsColour(0x0000, 0xffff, 0x8000, 0, alertIntervalMsec);
		}else{
			//lx.lightsColour(0x0000, 0xffff, 0x1000, 0, alertIntervalMsec);
			redAlertBrightLight.apply(alertIntervalMsec);
		}
		alertIsBright = !alertIsBright;
	}
}
var alertTimerRef = setInterval(alertFunction, 1000);


var app = module.exports = express();

var tcpPort = 3000;

// Configuration
app.configure(function(){
  app.set('views', __dirname + '/views');
  app.set('view engine', 'ejs');
  app.use(express.bodyParser());
  app.use(express.methodOverride());
  app.use(app.router);
  app.use(express.static(__dirname + '/public'));
});

app.configure('development', function(){
  app.use(express.errorHandler({ dumpExceptions: true, showStack: true }));
});

app.configure('production', function(){
  app.use(express.errorHandler());
});

// Routes
console.log(routes.index);
app.get('/', routes.index);
app.get('/model', artemisModel.returnModelAsJSON);
app.get('/map', routes.map);
app.get('/bearing-table', routes.bearingTable);
app.get('/proximity', routes.proximity);



// Set up the socket.io stuff
// This basically will relay all artemis server packets to any browser
//   listening to the appropiate socket.io sockets.
// Socket.io is clever enough to not send unneeded messages to
//   clients

var server = require('http').Server(app);
var io = require('socket.io').listen(server);
io.set('log level', 1); // reduce logging

server.listen(tcpPort);


// When socket.io is ready: for every packet we receive from the
//   Artemis server, send a websocket to all connected browsers.
io.sockets.on('connection', function (s){
	artemisNet.on('packet', function(data, packetType){
		if (packetType == 'unknownUpdate') {return;}
		s.emit(packetType, data);
	});
});


// Inform the browsers of connections/disconnections to/from Artemis server
artemisNet.on('connected', function(){
	console.log('We seem to have connected.')
	io.sockets.emit('connected');
});
artemisNet.on('disconnected', function(){
	io.sockets.emit('disconnected');
});



function grabStations() {
	/// FIXME!!! This is the console selection code, and perhaps should not
	///   be placed here.
	artemisNet.emit('setStation', {station:0, selected:1});	// Main Scr
// 	artemisNet.emit('setStation', {station:1, selected:1}); // Helm
// 	artemisNet.emit('setStation', {station:2, selected:1}); // Weap
// 	artemisNet.emit('setStation', {station:3, selected:1}); // Engine
	artemisNet.emit('setStation', {station:4, selected:1}); // Sci
	artemisNet.emit('setStation', {station:5, selected:1}); // Comms
	artemisNet.emit('setStation', {station:6, selected:1}); // Observ
// 	artemisNet.emit('setStation', {station:7, selected:1}); // Capt
// 	artemisNet.emit('setStation', {station:8, selected:1}); // GM
	
	artemisNet.emit('ready'); 
	console.log('Consoles have been requested.')
	
}

artemisNet.on('welcome', function(){
	console.log('We seem to have been welcomed.')
	
	grabStations();
});

artemisNet.on('damcon',function(data){
	console.log("Subsystem count " + data.nodes.length);
	for(var i = 0; i < data.nodes.length; i++ ){
		var node = data.nodes[i];
		subsystems[":" + node.x + ":" + node.y +":"+node.z] = node;

		console.log("Dammage tu subsystem: " + data.nodes[i].damage);
	}
	var curDam = 0;
	for (var nodeKey in subsystems) {
  		var node = subsystems[nodeKey];
  		curDam += node.damage;
	}	
	console.log("CurDam " + curDam );
	if(curDam > 0){
		shipDamage = curDam/15;
		if(shipDamage > 1){
			shipDamage = 1;
		}
	}else{
		shipDamage = 0;
	}
	console.log("Current ship damage:" + shipDamage );

});


artemisNet.on('playerShipDamage',function(data){

	var l;
	if(currentLight != null){
		l = currentLight.clone();
	}else{
		l = defaultLightState.clone();
	}
	l.lum = 0x8000;
	l.apply(100,true);
	//lx.lightsColour(39072, 0xffff, 0x8000, 0, 100);
	setTimeout(function(){
		l.lum = 0x4000;
		l.apply(90,true);
		//lx.lightsColour(39072, 0xffff, 0x4000, 0x0af0, 90);
	},100);
	setTimeout(function(){
		l.lum = 0x3000;
		l.apply(90,true);
		//lx.lightsColour(39072, 0xffff, 0x3000, 0x0af0, 90);
	},200);
	setTimeout(function(){
		//l.lum = 0x8000;
		applyCurrentStateLight(90);
		//lx.lightsColour(39072, 0xffff, 0x8000, 0x0af0, 90);
	},300);
});

var shieldUpdateTicker = 0;

artemisNet.on('gameOver',function(data){
	clearGameState();
	console.log("Clearing game state becouse of game over");
});

artemisNet.on('playerUpdate',function(data) {
	//console.log(data.shieldState)
	if(data.forShields != undefined){
		shieldPower = data.forShields;
		if(shieldUpdateTicker > 10){
			applyCurrentStateLight(0);
			shieldUpdateTicker = 0;
		}
		shieldUpdateTicker++;
	}
	if(data.forShieldsMax != undefined){
		maxShieldPower = data.forShieldsMax;
	}
	
	if (data.hasOwnProperty('redAlert')) {
		

		if (data.redAlert) {
			console.log("RED ALERT!");
			if(playerCh1 != null){
				playerCh1.kill();
				playerCh1 = null;
			}
			if(playerCh2 != null){
				playerCh2.kill();
				playerCh2 = null;
			}
			playerCh1 = spawn("vlc",["codered.ogg","-R","--qt-start-minimized","--qt-notification=0"]);
			playerCh2 = spawn("vlc",["alarm.mp3","-R","--qt-start-minimized","--qt-notification=0"]);
			alertIsOn = true;
		} else {
			if(alertIsOn){
				console.log("NO ALERT!");
				alertIsOn = false;
				console.log("RedAlert Off");
				if(playerCh1 != null){
					playerCh1.kill();
					playerCh1 = null;
				}
				if(playerCh2 != null){
					playerCh2.kill();
					playerCh2 = null;
				}
				applyCurrentStateLight(0x0513);
				//lx.lightsColour(0x0000, 0x0000, 0x8000, 0x0af0, 0x0513);
			}
		}
	}else{
		if(data.shieldState === 1){
			console.log("Shields UP!");
			shieldsAreUp = true;
			//lx.lightsColour(39072, 0xffff, 0x8000, 0, 0x0513);
			applyCurrentStateLight(0x0513);
			//shieldLight.apply( 0x0513);

		}else if(data.shieldState === 0){
			console.log("Shields DOWN!");
			shieldsAreUp = false;
			//lx.lightsColour(37836, 0x4fff, 0x1000, 0x0af0, 0x0513);
			applyCurrentStateLight(0x0513);
			//defaultLightState.apply( 0x0513);
		}
	}

	if(firstUpdate){
		console.log("Initiating lights on first update");
		applyCurrentStateLight(0x0513);
		firstUpdate = false;
	}
	
	
});

// Functionality for connecting/disconnecting to/from the server
//   and knowing our own public IP address (which is different from
//   'localhost', which is used in the internal web browser).
var artemisServerAddr = null;
app.get('/connect/:server', function(req,res){
	artemisNet.connect(req.params.server, 10);
	artemisServerAddr = req.params.server;
	res.end();
});
app.get('/disconnect', function(req,res){
	artemisNet.disconnect();
	res.end();
});
app.get('/artemis-server', function(req,res){
	if (artemisServerAddr) {
		res.write(artemisServerAddr);
	}
	res.end();
});
app.get('/glitter-address', function(req,res){

	var publicIPs = [];
	// Network interface detection is done every time, so that
	//   the glitter server can accommodate changes to its
	//   network profile, e.g. connect to a wifi network
	// With inspiration from https://stackoverflow.com/questions/3653065/get-local-ip-address-in-node-js
	var os=require('os');
	var ifaces=os.networkInterfaces();
	for (var dev in ifaces) {
		ifaces[dev].forEach(function(details){
			if (details.family=='IPv4') {
				if (details.address.toString().substr(0,3)!=="127") {
					publicIPs.push(details.address);
				}
			}
		});
	}

	res.write(JSON.stringify(publicIPs));
	res.end();
});


app.get('/ship-select/:shipIndex', function(req,res){
	artemisNet.emit('shipSelect', {shipIndex:req.params.shipIndex});
	grabStations();
	res.end();
});



var headless = false;
var autoConnect = false;

for (var i in process.argv) {
	if (process.argv[i] == '--headless') {
		headless = true;
	}
	if (process.argv[i] == '--server' && process.argv.length > i) {
		autoConnect = process.argv[parseInt(i)+1];
		console.log('Will autoconnect to server at ' + autoConnect);
	}
}

if (autoConnect) {
	artemisNet.connect(autoConnect,5);
}

// Once everything's ready, try open the default browser with the main page.
if (!headless) {
	//opener('http://localhost:' + tcpPort);
}
