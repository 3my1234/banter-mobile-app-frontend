import "react-native-get-random-values";
import QuickCrypto, { install } from "react-native-quick-crypto";

// Ensure global crypto + Buffer are available before Web3Auth loads.
install();

import "expo-router/entry";
