package calendar

import (
	"context"
	"net/http"
	"time"

	googlecalendar "google.golang.org/api/calendar/v3"
	"google.golang.org/api/option"
)

// Event はアプリ内で扱う予定の共通表現。
// 将来Outlookを追加する際も、この形に変換して同じように扱う想定。
type Event struct {
	ID      string
	Summary string
	Start   string
	End     string
}

// FetchRange は認証済みクライアントを使い、指定期間内の予定を取得する。
// 「有休」「全休」などの終日予定(時刻を持たない予定)はカレンダーグリッドに
// 差し込めない(何時から何時かが分からない)ため除外する。
// 「不在」のように時刻付きの予定はその時間帯の予定として重要なため残す。
func FetchRange(ctx context.Context, client *http.Client, from, to time.Time) ([]Event, error) {
	srv, err := googlecalendar.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, err
	}

	var events []Event
	pageToken := ""

	// Google Calendar APIは1リクエストあたり最大250件までしか返さないため、
	// nextPageToken が無くなるまでページを辿って全件取得する。
	for {
		call := srv.Events.List("primary").
			SingleEvents(true).
			OrderBy("startTime").
			TimeMin(from.Format(time.RFC3339)).
			TimeMax(to.Format(time.RFC3339)).
			MaxResults(250)
		if pageToken != "" {
			call = call.PageToken(pageToken)
		}

		resp, err := call.Do()
		if err != nil {
			return nil, err
		}

		for _, item := range resp.Items {
			if item.Start.DateTime == "" {
				continue
			}

			events = append(events, Event{
				ID:      item.Id,
				Summary: item.Summary,
				Start:   item.Start.DateTime,
				End:     item.End.DateTime,
			})
		}

		if resp.NextPageToken == "" {
			break
		}
		pageToken = resp.NextPageToken
	}

	return events, nil
}

// CreateEvent は指定した内容でGoogleカレンダーに新しい予定を作成する。
func CreateEvent(ctx context.Context, client *http.Client, summary string, start, end time.Time) (*Event, error) {
	srv, err := googlecalendar.NewService(ctx, option.WithHTTPClient(client))
	if err != nil {
		return nil, err
	}

	event := &googlecalendar.Event{
		Summary: summary,
		Start:   &googlecalendar.EventDateTime{DateTime: start.Format(time.RFC3339)},
		End:     &googlecalendar.EventDateTime{DateTime: end.Format(time.RFC3339)},
	}

	created, err := srv.Events.Insert("primary", event).Do()
	if err != nil {
		return nil, err
	}

	return &Event{
		ID:      created.Id,
		Summary: created.Summary,
		Start:   created.Start.DateTime,
		End:     created.End.DateTime,
	}, nil
}
