package main

import (
	"context"
	"log"
	"net/http"
	"os"

	"personal-calendar/internal/bootstrap"
	"personal-calendar/internal/reminder"
)

func main() {
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	app, err := bootstrap.New()
	if err != nil {
		log.Fatalf("failed to initialize app: %v", err)
	}
	defer func() {
		if err := app.Close(); err != nil {
			log.Printf("failed to close app: %v", err)
		}
	}()

	go reminder.Run(context.Background(), app.GoogleSvc, app.PushSvc, app.Store)

	log.Printf("starting server on :%s", port)
	if err := http.ListenAndServe(":"+port, app.Router); err != nil {
		log.Fatal(err)
	}
}
