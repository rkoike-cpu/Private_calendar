package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
)

// デフォルトの地点座標(麹町本社付近)。将来的にはユーザー設定で変更できるようにする。
const (
	defaultLatitude  = 35.6812
	defaultLongitude = 139.7502
)

type HourlyPoint struct {
	Time        string  `json:"time"`
	TempC       float64 `json:"tempC"`
	HumidityPct float64 `json:"humidityPct"`
	WeatherCode int     `json:"weatherCode"`
}

type Forecast struct {
	Hourly []HourlyPoint `json:"hourly"`
}

type openMeteoResponse struct {
	Hourly struct {
		Time               []string  `json:"time"`
		Temperature2m      []float64 `json:"temperature_2m"`
		RelativeHumidity2m []float64 `json:"relative_humidity_2m"`
		WeatherCode        []int     `json:"weather_code"`
	} `json:"hourly"`
}

// FetchToday は今日1日分・1時間ごとの天気予報を取得する。
// Open-Meteo (https://open-meteo.com) はAPIキー不要・無料で利用できる。
func FetchToday(ctx context.Context) (*Forecast, error) {
	url := fmt.Sprintf(
		"https://api.open-meteo.com/v1/forecast?latitude=%f&longitude=%f&hourly=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia%%2FTokyo&forecast_days=1",
		defaultLatitude, defaultLongitude,
	)

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	var parsed openMeteoResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, err
	}

	forecast := &Forecast{Hourly: make([]HourlyPoint, 0, len(parsed.Hourly.Time))}
	for i, t := range parsed.Hourly.Time {
		forecast.Hourly = append(forecast.Hourly, HourlyPoint{
			Time:        t,
			TempC:       parsed.Hourly.Temperature2m[i],
			HumidityPct: parsed.Hourly.RelativeHumidity2m[i],
			WeatherCode: parsed.Hourly.WeatherCode[i],
		})
	}
	return forecast, nil
}
