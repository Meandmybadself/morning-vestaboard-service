# morning-vestaboard-service
A service to schedule / orchestrate Vestaboard messages from live datasources.

## Related
* [Vestaboard API Documentation](https://docs.vestaboard.com/)
* [Working Journal](https://docs.google.com/document/d/1_wCVPFfBTEwc2AGBbYx0KAjT2svYsAv0UfnA3rdy61I/edit)

## Environment Variables
* `WEATHER_TOKEN` - openweathermap API token
* `WEATHER_LAT` - location latitude
* `WEATHER_LON` - location longitude
* `VESTABOARD_API_KEY` - Vestaboard API key
* `LATE_BUS_SHEET_URL` - URL of the public Google Sheet with late bus data