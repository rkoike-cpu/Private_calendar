package weather

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"
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
	// Condition: "clear" | "partly-cloudy" | "cloudy" | "fog" | "rain" | "snow" | "thunder" | "unknown"
	Condition string `json:"condition"`
}

type Forecast struct {
	Hourly []HourlyPoint `json:"hourly"`
}

// Service はWeatherAPI.com (https://www.weatherapi.com) を使って天気予報を取得する。
// Open-Meteoは接続元IP単位でレート制限がかかり、Renderの無料プランでは他利用者と
// IPを共有しているため制限に巻き込まれる問題があった。WeatherAPI.comはAPIキー単位で
// クォータが管理されるため、その影響を受けない。
type Service struct {
	apiKey string
}

func NewService(apiKey string) *Service {
	return &Service{apiKey: apiKey}
}

type weatherAPIResponse struct {
	Forecast struct {
		Forecastday []struct {
			Hour []struct {
				TimeEpoch int64   `json:"time_epoch"`
				TempC     float64 `json:"temp_c"`
				Humidity  float64 `json:"humidity"`
				Condition struct {
					Code int `json:"code"`
				} `json:"condition"`
			} `json:"hour"`
		} `json:"forecastday"`
	} `json:"forecast"`
}

// FetchToday は今日1日分・1時間ごとの天気予報を取得する。
func (s *Service) FetchToday(ctx context.Context) (*Forecast, error) {
	q := url.Values{}
	q.Set("key", s.apiKey)
	q.Set("q", fmt.Sprintf("%f,%f", defaultLatitude, defaultLongitude))
	q.Set("days", "1")
	q.Set("aqi", "no")
	q.Set("alerts", "no")

	reqURL := "https://api.weatherapi.com/v1/forecast.json?" + q.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, err
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 1024))
		return nil, fmt.Errorf("weatherapi returned status %d: %s", resp.StatusCode, body)
	}

	var parsed weatherAPIResponse
	if err := json.NewDecoder(resp.Body).Decode(&parsed); err != nil {
		return nil, fmt.Errorf("decode weatherapi response: %w", err)
	}
	if len(parsed.Forecast.Forecastday) == 0 {
		return nil, fmt.Errorf("weatherapi returned no forecast data")
	}

	hours := parsed.Forecast.Forecastday[0].Hour
	forecast := &Forecast{Hourly: make([]HourlyPoint, 0, len(hours))}
	for _, h := range hours {
		forecast.Hourly = append(forecast.Hourly, HourlyPoint{
			Time:        time.Unix(h.TimeEpoch, 0).UTC().Format(time.RFC3339),
			TempC:       h.TempC,
			HumidityPct: h.Humidity,
			Condition:   categorize(h.Condition.Code),
		})
	}
	return forecast, nil
}

// categorize はWeatherAPI.comの天気コードを、フロント側で扱いやすい
// 大まかなカテゴリ文字列に変換する。
func categorize(code int) string {
	switch {
	case code == 1000:
		return "clear"
	case code == 1003:
		return "partly-cloudy"
	case code == 1006 || code == 1009:
		return "cloudy"
	case code == 1030 || code == 1135 || code == 1147:
		return "fog"
	case code == 1066 || code == 1114 || code == 1117 ||
		(code >= 1210 && code <= 1225) || code == 1237 ||
		(code >= 1255 && code <= 1264):
		return "snow"
	case code == 1087 || (code >= 1273 && code <= 1282):
		return "thunder"
	case (code >= 1063 && code <= 1201) || (code >= 1240 && code <= 1246):
		return "rain"
	default:
		return "unknown"
	}
}
