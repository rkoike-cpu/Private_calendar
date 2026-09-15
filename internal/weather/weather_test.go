package weather

import "testing"

func TestCategorize(t *testing.T) {
	cases := []struct {
		name string
		code int
		want string
	}{
		{"晴れ", 1000, "clear"},
		{"晴れ時々曇り", 1003, "partly-cloudy"},
		{"曇り", 1006, "cloudy"},
		{"本曇り", 1009, "cloudy"},
		{"霧", 1030, "fog"},
		{"着氷性の霧", 1147, "fog"},
		{"雨", 1183, "rain"},
		{"みぞれ(軽い)", 1204, "rain"},
		{"みぞれ(にわか雨)", 1249, "rain"},
		{"雪", 1213, "snow"},
		{"吹雪", 1117, "snow"},
		{"雷雨", 1087, "thunder"},
		{"雷を伴う雪", 1279, "thunder"},
		{"未知のコード", 9999, "unknown"},
	}

	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got := categorize(c.code)
			if got != c.want {
				t.Errorf("categorize(%d) = %q, want %q", c.code, got, c.want)
			}
		})
	}
}
