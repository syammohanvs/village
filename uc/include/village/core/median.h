#pragma once

#include <cstddef>
#include <cstdint>

namespace village {

// Small fixed-size median window.  Used by the soil, reservoir and bin
// filters so one noisy sample cannot move the reported state.
template <typename T, std::size_t N>
class MedianWindow {
 public:
  static_assert(N > 0 && N <= 21, "median window is capped at 21 samples");

  void clear() {
    count_ = 0;
    next_ = 0;
  }

  void push(T value) {
    values_[next_] = value;
    next_ = (next_ + 1) % N;
    if (count_ < N) ++count_;
  }

  std::size_t count() const { return count_; }
  bool empty() const { return count_ == 0; }

  T median() const { return medianOf(count_); }

  // Median of the newest `wanted` samples.  If fewer samples exist, all of
  // them are used.  This lets a runtime setting choose 3, 5 or 9 samples
  // without changing the compile-time ring size.
  T medianOf(std::size_t wanted) const {
    if (count_ == 0) return T{};
    if (wanted == 0 || wanted > count_) wanted = count_;
    T copy[N];
    std::size_t start = (next_ + N - wanted) % N;
    for (std::size_t i = 0; i < wanted; ++i) {
      copy[i] = values_[(start + i) % N];
    }
    // Insertion sort: N is at most 21.
    for (std::size_t i = 1; i < wanted; ++i) {
      T key = copy[i];
      std::size_t j = i;
      while (j > 0 && copy[j - 1] > key) {
        copy[j] = copy[j - 1];
        --j;
      }
      copy[j] = key;
    }
    if (wanted % 2 == 1) return copy[wanted / 2];
    // Even count: average the two middle values.
    return static_cast<T>((copy[wanted / 2 - 1] + copy[wanted / 2]) / 2);
  }

 private:
  T values_[N]{};
  std::size_t count_ = 0;
  std::size_t next_ = 0;
};

}  // namespace village
