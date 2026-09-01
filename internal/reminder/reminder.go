// Package reminder は、開始が近づいた予定をチェックし、登録済みの端末に
// プッシュ通知でリマインダーを送る処理を担う。
//
// Renderのような常駐サーバーでのみ機能する(Vercelのようなサーバーレス環境では
// goroutineが常駐しないため、この定期チェックは成立しない)。
package reminder

import (
	"context"
	"log"
	"time"

	"personal-calendar/internal/auth"
	"personal-calendar/internal/calendar"
	"personal-calendar/internal/push"
	"personal-calendar/internal/store"
)

const (
	checkInterval = 1 * time.Minute
	reminderLead  = 10 * time.Minute
)

// Run はチェック間隔ごとに予定を確認し続ける。ctxがキャンセルされるまで戻らない。
func Run(ctx context.Context, googleSvc *auth.GoogleService, pushSvc *push.Service, st *store.Store) {
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		checkOnce(ctx, googleSvc, pushSvc, st)

		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

// checkOnce は「今からreminderLead後」の1分間の枠に開始する予定を探し、
// まだ通知していなければ送信する。
func checkOnce(ctx context.Context, googleSvc *auth.GoogleService, pushSvc *push.Service, st *store.Store) {
	client, ok := googleSvc.HTTPClient(ctx)
	if !ok {
		return // まだGoogleカレンダーが未連携
	}

	now := time.Now()
	windowStart := now.Add(reminderLead)
	windowEnd := windowStart.Add(checkInterval)

	events, err := calendar.FetchRange(ctx, client, windowStart, windowEnd)
	if err != nil {
		log.Printf("reminder: failed to fetch events: %v", err)
		return
	}

	for _, event := range events {
		start, err := time.Parse(time.RFC3339, event.Start)
		if err != nil || start.Before(windowStart) || !start.Before(windowEnd) {
			continue
		}

		sent, err := st.HasReminderBeenSent(event.ID)
		if err != nil {
			log.Printf("reminder: check sent status failed: %v", err)
			continue
		}
		if sent {
			continue
		}

		notifyAll(pushSvc, st, event)

		if err := st.MarkReminderSent(event.ID); err != nil {
			log.Printf("reminder: mark sent failed: %v", err)
		}
	}
}

func notifyAll(pushSvc *push.Service, st *store.Store, event calendar.Event) {
	subs, err := st.ListPushSubscriptions()
	if err != nil {
		log.Printf("reminder: list subscriptions failed: %v", err)
		return
	}

	title := "まもなく予定があります"
	body := event.Summary + "(10分後)"

	for _, sub := range subs {
		err := pushSvc.Send(push.Subscription{
			Endpoint: sub.Endpoint,
			P256dh:   sub.P256dh,
			Auth:     sub.Auth,
		}, title, body)

		if err == push.ErrSubscriptionExpired {
			if delErr := st.DeletePushSubscription(sub.Endpoint); delErr != nil {
				log.Printf("reminder: delete expired subscription failed: %v", delErr)
			}
			continue
		}
		if err != nil {
			log.Printf("reminder: send push failed: %v", err)
		}
	}
}
