package clioutput

import (
	"encoding/json"
	"fmt"
	"io"
)

func JSON(w io.Writer, value any, compact bool) error {
	var (
		data []byte
		err  error
	)
	if compact {
		data, err = json.Marshal(value)
	} else {
		data, err = json.MarshalIndent(value, "", "  ")
	}
	if err != nil {
		return err
	}
	_, err = fmt.Fprintln(w, string(data))
	return err
}
