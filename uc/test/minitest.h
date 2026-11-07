#pragma once

#include <cmath>
#include <cstdio>
#include <string>
#include <vector>

namespace minitest {

struct Test {
  const char* name;
  void (*fn)();
};

inline std::vector<Test>& tests() {
  static std::vector<Test> list;
  return list;
}

inline int& failures() {
  static int count = 0;
  return count;
}

inline int& checks() {
  static int count = 0;
  return count;
}

inline const char*& currentTest() {
  static const char* name = "";
  return name;
}

struct Registrar {
  Registrar(const char* name, void (*fn)()) { tests().push_back({name, fn}); }
};

inline void fail(const char* file, int line, const char* expression) {
  ++failures();
  std::printf("      FAIL %s:%d  %s\n", file, line, expression);
}

inline void near(double a, double b, double eps, const char* file, int line,
                 const char* text) {
  ++checks();
  if (!(std::fabs(a - b) <= eps)) {
    ++failures();
    std::printf("      FAIL %s:%d  %s  (%.9f vs %.9f, eps %.9f)\n", file, line,
                text, a, b, eps);
  }
}

}  // namespace minitest

#define TEST(name)                                                    \
  static void name();                                                 \
  static ::minitest::Registrar registrar_##name(#name, &name);        \
  static void name()

#define CHECK(cond)                                                   \
  do {                                                                \
    ++::minitest::checks();                                           \
    if (!(cond)) ::minitest::fail(__FILE__, __LINE__, #cond);         \
  } while (0)

#define CHECK_NEAR(a, b, eps)                                         \
  ::minitest::near((a), (b), (eps), __FILE__, __LINE__, #a " ~= " #b)

#define RUN_ALL()                                                     \
  int main() {                                                        \
    std::printf("Running %zu firmware core tests\n",                  \
                ::minitest::tests().size());                          \
    for (const auto& t : ::minitest::tests()) {                       \
      ::minitest::currentTest() = t.name;                             \
      std::printf("  [ RUN  ] %s\n", t.name);                         \
      t.fn();                                                         \
    }                                                                 \
    std::printf("\n%d checks, %d failed\n", ::minitest::checks(),    \
                ::minitest::failures());                              \
    if (::minitest::failures() == 0) std::printf("ALL FIRMWARE CORE TESTS PASSED\n"); \
    return ::minitest::failures() == 0 ? 0 : 1;                       \
  }
