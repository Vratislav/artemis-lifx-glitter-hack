
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


lifx.setDebug(false);
var lx = lifx.init();

var alertIsBright = false;
var alertIsOn = false;



var alertIntervalMsec = 1000;

var alertFunction = function(){
	if(alertIsOn){
		if(alertIsBright){
			lx.lightsColour(0x0000, 0xffff, 0x1000, 0, alertIntervalMsec);
			
		}else{
			lx.lightsColour(0x0000, 0xffff, 0x8000, 0, alertIntervalMsec);
			
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


artemisNet.on('playerShipDamage',function(data){
	lx.lightsColour(39072, 0xffff, 0x8000, 0, 100);
	setTimeout(function(){
		lx.lightsColour(39072, 0xffff, 0x4000, 0x0af0, 90);
	},100);
	setTimeout(function(){
		lx.lightsColour(39072, 0xffff, 0x3000, 0x0af0, 90);
	},200);
	setTimeout(function(){
		lx.lightsColour(39072, 0xffff, 0x8000, 0x0af0, 90);
	},300);
});


artemisNet.on('playerUpdate',function(data) {
	//console.log(data.shieldState)
	if(data.shieldState === 1){
		console.log("Shields UP!");
		lx.lightsColour(39072, 0xffff, 0x8000, 0, 0x0513);

	}else if(data.shieldState === 0){
		console.log("Shields DOWN!");
		lx.lightsColour(37836, 0x4fff, 0x1000, 0x0af0, 0x0513);
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
			playerCh1 = spawn("vlc",["codered.ogg","-R"]);
			playerCh2 = spawn("vlc",["alarm.mp3","-R"]);
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
				lx.lightsColour(0x0000, 0x0000, 0x8000, 0x0af0, 0x0513);
			}
		}
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
	opener('http://10.0.0.42:' + tcpPort);
}
