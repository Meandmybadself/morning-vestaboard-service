const { toDate, format, isWeekend, parseISO, isSameDay, differenceInSeconds } = require('date-fns');
const ical = require('node-ical');
const cheerio = require('cheerio');

// Service time configuration
const SERVICE_START = '13:00';
const SERVICE_END = '14:00';

// Vestaboard API configuration
const VESTABOARD_API_KEY = process.env.VESTABOARD_API_KEY;
const VESTABOARD_API_URL = 'https://rw.vestaboard.com/';
const VESTABOARD_COMPOSE_URL = 'https://vbml.vestaboard.com/compose';

// Weather configuration
const WEATHER_LAT = process.env.WEATHER_LAT;
const WEATHER_LON = process.env.WEATHER_LON;
const WEATHER_TOKEN = process.env.WEATHER_TOKEN;

// Lunch calendar URL
const LUNCH_CALENDAR_URL = 'https://mealcal.meandmybadself.com/?schoolId=EisenhowerElementaryMN&meal=Lunch';

// Bus configuration
const BUS_EXPECTED_TIME = '07:03';
const BUS_BUFFER_TIME = 10; // minutes
const BUS_NUMBER = process.env.BUS_NUMBER;
const LATE_BUS_SHEET_URL = process.env.LATE_BUS_SHEET_URL;

let initialBoardState;
let activeSlideIndex = 0;

const slides = ['weather', 'lunch', 'bus'];

async function getLunch() {
  console.log('🍽️ Fetching lunch data...');
  try {
    const response = await fetch(LUNCH_CALENDAR_URL);
    console.log(`🍽️ Lunch calendar response status: ${response.status}`);
    const icsData = await response.text();
    console.log('🍽️ ICS data fetched, parsing...');
    const events = await ical.async.parseICS(icsData);

    const today = new Date();
    console.log(`🍽️ Searching for lunch on ${format(today, 'yyyy-MM-dd')}`);
    let todayLunch
    try {
      todayLunch = Object.values(events).find(event =>
        event.type === 'VEVENT' && isSameDay(parseISO(event.start), today)
      );

    } catch (error) {
      console.error('🚨 Error parsing lunch data:', error);
      return 'No lunch data available for today';
    }
    
    if (!todayLunch) {
      console.log('🍽️ No lunch data available for today');
      return 'No lunch data available for today';
    }

    console.log('🍽️ Lunch data found, processing...');
    const lunchItems = todayLunch.description
      .split('\n')
      .filter(item => item.trim() !== '')
      .slice(0, 3);

    console.log(`🍽️ Lunch items: ${lunchItems.join(', ')}`);
    return `Today's Lunch:\n${lunchItems.join('\n')}`;
  } catch (error) {
    console.error('🚨 Error fetching lunch data:', error);
    return 'Error fetching lunch data';
  }
}

async function getWeather() {
  console.log('🌤️ Fetching weather data...');
  try {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/onecall?units=imperial&exclude=minutely,hourly&lat=${WEATHER_LAT}&lon=${WEATHER_LON}&appid=${WEATHER_TOKEN}`);
    console.log(`🌤️ Weather API response status: ${response.status}`);
    const data = await response.json();

    const current = data.current;
    const today = data.daily[0];

    console.log(`🌤️ Current temperature: ${current.temp.toFixed(0)}°F, ${current.weather[0].description}`);
    console.log(`🌤️ Today's high: ${today.temp.max.toFixed(0)}°F, low: ${today.temp.min.toFixed(0)}°F`);

    return `Today's Weather\n${current.temp.toFixed(0)}°F, ${current.weather[0].description}\nHigh: ${today.temp.max.toFixed(0)}°F, Low: ${today.temp.min.toFixed(0)}°F`;
  } catch (error) {
    console.error('🚨 Error fetching weather data:', error);
    return 'Error fetching weather data';
  }
}

async function getLateBus(busNumber) {
  console.log(`🚌 Checking for late bus data for bus ${busNumber}...`);
  try {
    const response = await fetch(LATE_BUS_SHEET_URL);
    console.log(`🚌 Late bus sheet response status: ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    let lateBusInfo = null;

    $('tr').each((index, element) => {
      const dateText = $(element).find('td').eq(0).text();
      const dateValue = parseISO(dateText);
      const busNumberText = $(element).find('td').eq(1).text();

      if (differenceInSeconds(new Date(), dateValue) <= 3600 && busNumberText.includes(busNumber)) {
        lateBusInfo = {
          lateMinutes: parseInt($(element).find('td').eq(4).text()),
          reason: $(element).find('td').eq(5).text(),
          details: $(element).find('td').eq(6).text()
        };
        return false; // break the loop
      }
    });

    if (lateBusInfo) {
      console.log(`🚌 Late bus info found: ${JSON.stringify(lateBusInfo)}`);
    } else {
      console.log('🚌 No late bus info found');
    }

    return lateBusInfo;
  } catch (error) {
    console.error('🚨 Error fetching late bus data:', error);
    return null;
  }
}

async function getBusCountdown() {
  console.log('🚌 Calculating bus countdown...');
  const now = new Date();
  const [busHour, busMinute] = BUS_EXPECTED_TIME.split(':').map(Number);
  let busTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), busHour, busMinute);

  // Subtract buffer time
  busTime.setMinutes(busTime.getMinutes() - BUS_BUFFER_TIME);

  // Check for late bus
  const lateBusInfo = await getLateBus(BUS_NUMBER);
  if (lateBusInfo) {
    busTime.setMinutes(busTime.getMinutes() + lateBusInfo.lateMinutes);
    console.log(`🚌 Bus is late by ${lateBusInfo.lateMinutes} minutes. New expected time: ${format(busTime, 'HH:mm')}`);
  }

  const diffInSeconds = differenceInSeconds(busTime, now);

  if (diffInSeconds <= 0) {
    console.log('🚌 Bus has already passed');
    return 'Bus arrives in 1m 32s';
  }

  const minutes = Math.floor(diffInSeconds / 60);
  const seconds = diffInSeconds % 60;

  console.log(`🚌 Bus arrives in ${minutes} minutes and ${seconds} seconds`);
  return `Bus arrives in ${minutes}m ${seconds}s`;
}

async function getCurrentBoardState() {
  console.log('📋 Fetching current board state...');
  try {
    const response = await fetch(VESTABOARD_API_URL, {
      headers: { 'X-Vestaboard-Read-Write-Key': VESTABOARD_API_KEY }
    });
    console.log(`📋 Board state response status: ${response.status}`);
    const data = await response.json();
    console.log('📋 Current board state fetched successfully');
    return data;
  } catch (error) {
    console.error('🚨 Error getting current board state:', error);
    return null;
  }
}

async function updateBoard(message) {
  console.log('🔄 Updating board...');
  try {
    let characterCodes;

    if (Array.isArray(message) && message.every(row => Array.isArray(row))) {
      // If message is already a 2D array of character codes
      characterCodes = message;
    } else {
      // If message is a string template, first convert it to character codes
      const response = await fetch(VESTABOARD_COMPOSE_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vestaboard-Read-Write-Key': VESTABOARD_API_KEY
        },
        body: JSON.stringify({

          components: [
            {
              "style": {
                "justify": "center",
                "align": "center"
              },
              template: message
            }]
        })
      });
      console.log(`🔄 Compose API response status: ${response.status}`);
      characterCodes = await response.json();
    }

    // Now send the character codes to update the board
    const updateResponse = await fetch(VESTABOARD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vestaboard-Read-Write-Key': VESTABOARD_API_KEY
      },
      body: JSON.stringify(characterCodes)
    });
    console.log(`🔄 Board update response status: ${updateResponse.status}`);

    if (updateResponse.ok) {
      console.log('🔄 Board updated successfully');
    } else {
      console.error('🚨 Failed to update board:', await updateResponse.text());
    }
  } catch (error) {
    console.error('🚨 Error updating board:', error);
  }
}

async function displaySlide() {
  console.log(`🎭 Displaying slide: ${slides[activeSlideIndex]}`);
  let message;
  switch (slides[activeSlideIndex]) {
    case 'lunch':
      message = await getLunch();
      break;
    case 'weather':
      message = await getWeather();
      break;
    case 'bus':
      message = await getBusCountdown();
      break;
  }
  await updateBoard(message);
  activeSlideIndex = (activeSlideIndex + 1) % slides.length;
  console.log(`🎭 Next slide index: ${activeSlideIndex}`);
}

function isServiceTime() {
  const now = new Date();
  const currentTime = format(now, 'HH:mm');
  const isWeekday = true // !isWeekend(now);
  const inServiceTime = isWeekday && currentTime >= SERVICE_START && currentTime <= SERVICE_END;
  console.log(`⏰ Current time: ${currentTime}, Is weekday: ${isWeekday}, In service time: ${inServiceTime}`);
  return inServiceTime;
}

async function main() {
  console.log('🚀 Starting Vestaboard display script...');
  while (true) {
    if (isServiceTime()) {
      if (!initialBoardState) {
        initialBoardState = await getCurrentBoardState();
        console.log('🏁 Service started. Initial board state saved.');
      }
      await displaySlide();
    } else if (initialBoardState) {
      await updateBoard(initialBoardState);
      initialBoardState = null;
      console.log('🏁 Service ended. Board restored to initial state.');
    }

    console.log('⏳ Waiting before next iteration...');
    await new Promise(resolve => setTimeout(resolve, 30000));
  }
}

main().catch(error => console.error('🚨 Unhandled error in main loop:', error));