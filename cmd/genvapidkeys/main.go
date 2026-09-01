// genvapidkeys はWeb Push通知に必要なVAPID鍵ペアを1度だけ生成するための使い捨てツール。
// 生成後、表示された値を環境変数として設定したらこのコマンドは削除してよい。
package main

import (
	"fmt"
	"log"

	"github.com/SherClockHolmes/webpush-go"
)

func main() {
	privateKey, publicKey, err := webpush.GenerateVAPIDKeys()
	if err != nil {
		log.Fatal(err)
	}
	fmt.Println("VAPID_PUBLIC_KEY=" + publicKey)
	fmt.Println("VAPID_PRIVATE_KEY=" + privateKey)
}
