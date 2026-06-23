package com.guitarreach.api;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;

@SpringBootApplication
@EnableAsync
public class GuitarReachApplication {
    public static void main(String[] args) {
        SpringApplication.run(GuitarReachApplication.class, args);
    }
}
