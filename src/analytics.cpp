#include <algorithm>
#include <cmath>
#include <iomanip>
#include <iostream>
#include <numeric>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Input format: normalThreshold|overloadThreshold|comma-separated watt readings
// Output: JSON analytics consumed by the Java API and browser dashboard.
int main() {
    std::string line;
    if (!std::getline(std::cin, line)) { std::cerr << "No input supplied\n"; return 2; }
    const auto first = line.find('|');
    const auto second = first == std::string::npos ? std::string::npos : line.find('|', first + 1);
    if (first == std::string::npos || second == std::string::npos) {
        std::cerr << "Expected threshold|threshold|readings\n"; return 2;
    }
    int normalThreshold = 0, overloadThreshold = 0;
    try {
        normalThreshold = std::stoi(line.substr(0, first));
        overloadThreshold = std::stoi(line.substr(first + 1, second - first - 1));
    } catch (...) { std::cerr << "Invalid thresholds\n"; return 2; }
    if (normalThreshold < 1 || overloadThreshold <= normalThreshold || overloadThreshold > 100000) {
        std::cerr << "Thresholds must be positive and overload must exceed normal\n"; return 2;
    }
    std::stringstream stream(line.substr(second + 1));
    std::string token;
    std::vector<double> values;
    while (std::getline(stream, token, ',')) {
        if (token.empty()) { std::cerr << "Empty reading\n"; return 2; }
        try {
            size_t used = 0;
            double v = std::stod(token, &used);
            if (used != token.size() || !std::isfinite(v) || v < 0 || v > 100000) throw std::invalid_argument("range");
            values.push_back(v);
        } catch (...) { std::cerr << "Invalid reading: " << token << "\n"; return 2; }
    }
    if (values.empty() || values.size() > 5000) { std::cerr << "Supply 1 to 5000 readings\n"; return 2; }
    const double total = std::accumulate(values.begin(), values.end(), 0.0);
    const double average = total / values.size();
    const size_t middle = values.size() / 2;
    const double firstHalf = middle ? std::accumulate(values.begin(), values.begin() + middle, 0.0) / middle : average;
    const double secondHalf = values.size() > middle ? std::accumulate(values.begin() + middle, values.end(), 0.0) / (values.size() - middle) : average;
    const std::string trend = secondHalf > firstHalf * 1.05 ? "RISING" : (secondHalf < firstHalf * 0.95 ? "FALLING" : "STABLE");
    int normal = 0, high = 0, overload = 0;
    double sumX = 0.0, sumY = 0.0, sumXX = 0.0, sumXY = 0.0;
    for (size_t i = 0; i < values.size(); ++i) {
        const double x = static_cast<double>(i), v = values[i];
        sumX += x; sumY += v; sumXX += x * x; sumXY += x * v;
    }
    const double n = static_cast<double>(values.size());
    const double denominator = n * sumXX - sumX * sumX;
    const double slope = denominator == 0.0 ? 0.0 : (n * sumXY - sumX * sumY) / denominator;
    const double intercept = (sumY - slope * sumX) / n;
    const double forecastNext = std::clamp(intercept + slope * n, 0.0, 100000.0);
    for (double v : values) {
        if (v <= normalThreshold) ++normal;
        else if (v <= overloadThreshold) ++high;
        else ++overload;
    }
    std::cout << std::fixed << std::setprecision(2)
              << "{\"trend\":\"" << trend << "\",\"averagePowerW\":" << average
              << ",\"firstHalfAverageW\":" << firstHalf << ",\"secondHalfAverageW\":" << secondHalf
              << ",\"peakPowerW\":" << *std::max_element(values.begin(), values.end())
              << ",\"forecastNextW\":" << forecastNext
              << ",\"engine\":\"C++\""
              << ",\"readingCount\":" << values.size()
              << ",\"clusters\":{\"low\":" << normal << ",\"medium\":" << high << ",\"high\":" << overload << "}"
              << ",\"normalThresholdW\":" << normalThreshold << ",\"overloadThresholdW\":" << overloadThreshold
              << ",\"algorithm\":\"Split-half trend (5% threshold) and profile-configurable power bands\"}\n";
    return 0;
}
