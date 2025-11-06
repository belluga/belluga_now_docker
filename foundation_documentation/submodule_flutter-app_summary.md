# Flutter Submodule Summary

This document provides a summary of the Flutter submodule, which is responsible for the mobile application.

## Architecture

The application follows a modular architecture, with a clear separation of concerns between the `application`, `domain`, and `infrastructure` layers. The presentation layer is organized by features and screens.

The application uses the `auto_route` package for navigation, which provides a declarative way to define routes and navigate between screens.

## Features

The application has the following features:

### Authentication

-   **Login:** Users can log in to the application.
-   **Password Recovery:** Users can recover their password.
-   **Create New Password:** Users can create a new password.

### Tenant

-   **Home:** The main screen for the tenant.
-   **Profile:** Users can view and edit their profile.
-   **Schedule:** Users can view their schedule.
-   **Event Search:** Users can search for events.
-   **City Map:** Users can view a map of the city.

### Landlord

-   **Home:** The main screen for the landlord.

## Routing

The application has the following routes:

-   `/init`: The initial route of the application.
-   `/`: The home screen for the tenant.
-   `/landlord`: The home screen for the landlord.
-   `/login`: The login screen.
-   `/recover_password`: The password recovery screen.
-   `/auth/create-password`: The create new password screen.
-   `/profile`: The user's profile screen.
-   `/agenda`: The schedule screen.
-   `/agenda/procurar`: The event search screen.
-   `/mapa`: The city map screen.
