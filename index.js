const { toDate, format, isWeekend, parseISO, isSameDay, differenceInSeconds } = require('date-fns');
const ical = require('node-ical');
const cheerio = require('cheerio');

// Service time configuration
const SERVICE_START = process.env.SERVICE_START
const SERVICE_END = process.env.SERVICE_END;

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

const slides = ['date', 'lunch', 'bus', 'weather'];

async function getLunch() {
  try {
    const response = await fetch(LUNCH_CALENDAR_URL);
    const icsData = await response.text();
    const events = await ical.async.parseICS(icsData);
    
    const today = new Date();
    let todayLunch
    try {
      todayLunch = Object.values(events).filter(event => !!event).find(event => event.type === 'VEVENT' && isSameDay(event.start, today));
    } catch (error) {
      console.log(error)
      return 'No lunch data available for today';
    }
    
    if (!todayLunch) {
      return 'No lunch data available for today';
    }

    const lunchItems = todayLunch.description
      .replace(/<br\/>/g, '\n')
      .split('\n')
      .filter(item => item.trim() !== '')
      .slice(0, 3);

    return `Today's Lunch:\n${lunchItems.join('\n')}`;
  } catch (error) {
    return 'Error fetching lunch data';
  }
}

async function getWeather() {
  try {
    const response = await fetch(`https://api.openweathermap.org/data/2.5/onecall?units=imperial&exclude=minutely,hourly&lat=${WEATHER_LAT}&lon=${WEATHER_LON}&appid=${WEATHER_TOKEN}`);
    const data = await response.json();

    const current = data.current;
    const today = data.daily[0];

    return `Today's Weather\n${current.temp.toFixed(0)}°F, ${current.weather[0].description}\nHigh: ${today.temp.max.toFixed(0)}°F\nLow: ${today.temp.min.toFixed(0)}°F`;
  } catch (error) {
    return 'Error fetching weather data';
  }
}

async function getLateBus(busNumber) {
  try {
    const response = await fetch(LATE_BUS_SHEET_URL);
    const html = await response.text();
    const $ = cheerio.load(html);

    let lateBusInfo = null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    $('tr').each((index, element) => {
      const dateText = $(element).find('td').eq(0).text().trim().split(' ')[0] 
      const [month, day, year] = dateText.split('/').map(Number);
      const dateValue = new Date(year, month - 1, day); 
      const busNumberText = $(element).find('td').eq(1).text();

      if (dateValue.getTime() === today.getTime() && busNumberText.includes(busNumber)) {
        lateBusInfo = {
          lateMinutes: parseInt($(element).find('td').eq(4).text()),
          reason: $(element).find('td').eq(5).text() || '',
          details: $(element).find('td').eq(6).text() || ''
        };
        return false; // break the loop
      }
    });

    return lateBusInfo;
  } catch (error) {
    console.error('Error in getLateBus:', error);
    return null;
  }
}

async function getBusCountdown() {
  const now = new Date();
  const [busHour, busMinute] = BUS_EXPECTED_TIME.split(':').map(Number);
  let busTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), busHour, busMinute);
  
  // Subtract buffer time
  busTime.setMinutes(busTime.getMinutes() - BUS_BUFFER_TIME);

  // Check for late bus
  const lateBusInfo = await getLateBus(BUS_NUMBER);
  if (lateBusInfo) {
    busTime.setMinutes(busTime.getMinutes() + lateBusInfo.lateMinutes);
  }

  const diffInSeconds = differenceInSeconds(busTime, now);

  if (diffInSeconds <= 0) {
    return 'No bus today.';
  }

  const minutes = Math.floor(diffInSeconds / 60);
  const seconds = diffInSeconds % 60;

  let message = `Bus arrives in\n${minutes}m ${seconds}s`;
  if (lateBusInfo?.lateMinutes) {
    message += `\nLate: ${lateBusInfo.lateMinutes}min.`
  }
  if (lateBusInfo?.reason) {
    message += `\n${lateBusInfo.reason}`;
  }

  return message
}

async function getCurrentBoardState() {
  try {
    const response = await fetch(VESTABOARD_API_URL, {
      headers: { 'X-Vestaboard-Read-Write-Key': VESTABOARD_API_KEY }
    });
    const data = await response.json();
    return data;
  } catch (error) {
    return null;
  }
}

async function updateBoard(message) {
  try {
    let characterCodes;

    if (Array.isArray(message) && message.every(row => Array.isArray(row))) {
      characterCodes = message;
    } else {
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
      characterCodes = await response.json();
    }

    await fetch(VESTABOARD_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vestaboard-Read-Write-Key': VESTABOARD_API_KEY
      },
      body: JSON.stringify(characterCodes)
    });
  } catch (error) {
    // Error handling
  }
}

async function getDateAndTime() {
  const now = new Date();
  const dateString = format(now, 'EEEE, MMMM d');
  const timeString = format(now, 'HH:mm');
  return `Good morning.\nToday is ${dateString}\nand the time is ${timeString}.`;
}

async function displaySlide() {
  let message;
  switch (slides[activeSlideIndex]) {
    case 'date':
      message = await getDateAndTime();
      break;
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
}

function isServiceTime() {
  if (process.env.IS_SERVICE_TIME === 'true') {
    return true;
  }
  const now = new Date();
  const currentTime = format(now, 'HH:mm');
  const isWeekday = !isWeekend(now);
  return isWeekday && currentTime >= SERVICE_START && currentTime <= SERVICE_END;
}

async function main() {
  while (true) {
    if (isServiceTime()) {
      if (!initialBoardState) {
        initialBoardState = await getCurrentBoardState();
      }
      await displaySlide();
    } else if (initialBoardState) {
      await updateBoard(initialBoardState);
      initialBoardState = null;
    }

    await new Promise(resolve => setTimeout(resolve, 60000));
  }
}

main().catch(error => {
  console.log('error', error)
});