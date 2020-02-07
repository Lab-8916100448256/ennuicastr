/*
 * Copyright (c) 2018-2020 Yahweasel
 *
 * Permission to use, copy, modify, and/or distribute this software for any
 * purpose with or without fee is hereby granted, provided that the above
 * copyright notice and this permission notice appear in all copies.
 *
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
 * WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY
 * SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
 * WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
 * OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
 * CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.
 */

// Basic DOM stuff
var dce = document.createElement.bind(document);
var gebi = document.getElementById.bind(document);
var log = gebi("log");

// For feature selection in audio
var plzyes = {ideal: true};
var plzno = {ideal: false};

// Short name for our protocol
var prot = EnnuiCastrProtocol;

// Opus zero packet, will be replaced with FLAC's version if needed
var zeroPacket = new Uint8Array([0xF8, 0xFF, 0xFE]);

// Configuration, which will be filled in by loading code
var config;

/* We have multiple connections to the server:
 * One for pings,
 * one to send data, and
 * if we're the master, one for master communication */
var pingSock = null;
var dataSock = null;
var masterSock = null;

// There are a lot of intermediate steps to getting audio from point A to point B
var userMedia = null; // The microphone input for recording
var userMediaRTC = null; // The microphone input for RTC
var userMediaAvailableEvent = new EventTarget(); // "ready" fires when userMedia is ready
var fileReader = null; // Used to transfer Opus data from the built-in encoder
var mediaRecorder = null; // Either the built-in media recorder or opus-recorder
var ac = null; // The audio context for our scripts
var flacEncoder = null; // If using FLAC

// Our input sample rate
var sampleRate = 48000;

// Which technology to use. If both false, we'll use built-in Opus.
var useOpusRecorder = false;
var useFlac = ((config.format&prot.flags.dataTypeMask) === prot.flags.dataType.flac);

// Which features to use
var useContinuous = !!(config.format&features.continuous);
var useRTC = !!(config.format&features.rtc);

// Our RTC peer connections
var rtcConnections = {};

// WebRTCVAD's raw output
var rawVadOn = false;

// VAD output after our cooldown
var vadOn = false;

// Number of milliseconds to run the VAD for before/after talking
var vadExtension = 2000;

// When we're not sending real data, we have to send a few (arbitrarily, 3) empty frames
var sentZeroes = 999;

/* To help with editing by sending a clean silence sample, we send the
 * first few (arbitrarily, 8) seconds of VAD-off silence */
var sendSilence = 400;

// The data used by both the level-based VAD and display
var waveData = [];
var waveVADs = [];
var waveVADColors = ["#000", "#aaa", "#073", "#0a3"];

// The display canvas and data
var waveCanvas = null;
var waveWatcher = null;
var waveRotate = false;

// Our start time is in local ticks, and our offset is updated every so often
var startTime = 0;
var timeOffset = null;

/* So that the time offset doesn't jump all over the place, we adjust it
 * *slowly*. This is the target time offset */
var targetTimeOffset = null;

// And this is the amount to adjust it per frame (1%)
var timeOffsetAdjPerFrame = 0.0002;

/* We keep track of the last time we successfully encoded data for
 * transfer, to determine if anything's gone wrong */
var lastSentTime = 0;

// The delays on the pongs we've received back
var pongs = [];

// The current blobs waiting to be read
var blobs = [];

// The current ArrayBuffers of data to be handled
var data = [];

// The Opus or FLAC packets to be handled. Format: [granulePos, data]
var packets = [];