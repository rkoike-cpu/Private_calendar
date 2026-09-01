// Package push はWeb Push APIを使い、ブラウザ(スマホのホーム画面に追加したPWA含む)へ
// 通知を送る処理をまとめる。
package push

import (
	"encoding/json"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// Subscription はブラウザから登録された購読情報。
type Subscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

// Service はVAPID鍵を使って通知を送信する。
type Service struct {
	publicKey  string
	privateKey string
	subject    string // 通知の送信元として名乗る連絡先(mailto:...)
}

func NewService(publicKey, privateKey, subject string) *Service {
	return &Service{publicKey: publicKey, privateKey: privateKey, subject: subject}
}

// PublicKey はフロントエンドが購読登録する際に必要なVAPID公開鍵を返す。
func (s *Service) PublicKey() string {
	return s.publicKey
}

type payload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}

// Send は指定した購読先に通知を送る。
// 購読が失効している場合(410 Gone等)は ErrSubscriptionExpired を返す。
func (s *Service) Send(sub Subscription, title, body string) error {
	data, err := json.Marshal(payload{Title: title, Body: body})
	if err != nil {
		return err
	}

	resp, err := webpush.SendNotification(data, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		Subscriber:      s.subject,
		VAPIDPublicKey:  s.publicKey,
		VAPIDPrivateKey: s.privateKey,
		TTL:             60,
	})
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	if resp.StatusCode == 404 || resp.StatusCode == 410 {
		return ErrSubscriptionExpired
	}
	return nil
}

var ErrSubscriptionExpired = &expiredError{}

type expiredError struct{}

func (*expiredError) Error() string { return "push subscription expired" }
