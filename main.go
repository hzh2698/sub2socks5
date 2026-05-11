package main

import (
    "fmt"
    "os"

    "sub2socks5-go/internal/app"
)

func main() {
    if err := app.Run(); err != nil {
        fmt.Fprintln(os.Stderr, err)
        os.Exit(1)
    }
}
